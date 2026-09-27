from pathlib import Path
import uuid
import redis
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import current_user, admin, passwords, token_for
from .config import settings
from .db import get_db
from .models import User, Request, Attachment, Subscription, Delivery
from .schemas import (
    Login,
    UserCreate,
    UserOut,
    RoleUpdate,
    RequestInput,
    StatusUpdate,
    SubscriptionInput,
)
from .webhooks import enqueue, validate_url

app = FastAPI(title="RelayDesk API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def request_for(db, request_id, user):
    item = db.get(Request, request_id)
    if not item or (user.role == "customer" and item.customer_id != user.id):
        raise HTTPException(404, "Request not found")
    return item


def subscription_out(item):
    return {"id": item.id, "url": item.url, "active": item.active}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    try:
        redis.Redis.from_url(
            settings.redis_url, socket_connect_timeout=1, socket_timeout=1
        ).ping()
    except redis.RedisError:
        raise HTTPException(503, "Redis unavailable")
    return {"status": "ok"}


@app.post("/auth/login")
def login(body: Login, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not passwords.verify(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {
        "access_token": token_for(user),
        "token_type": "bearer",
        "user": UserOut.model_validate(user),
    }


@app.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@app.get("/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), user: User = Depends(admin)):
    return db.scalars(select(User).order_by(User.id)).all()


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate, db: Session = Depends(get_db), user: User = Depends(admin)
):
    item = User(
        email=body.email,
        name=body.name,
        role=body.role,
        password_hash=passwords.hash(body.password),
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email already exists")
    return item


@app.patch("/users/{user_id}", response_model=UserOut)
def update_role(
    user_id: int,
    body: RoleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(admin),
):
    item = db.get(User, user_id)
    if not item:
        raise HTTPException(404, "User not found")
    if item.id == user.id and body.role != "admin":
        raise HTTPException(409, "You cannot remove your own administrator role")
    item.role = body.role
    db.commit()
    return item


@app.get("/requests")
def requests(
    status: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = select(Request)
    if user.role == "customer":
        query = query.where(Request.customer_id == user.id)
    if status:
        query = query.where(Request.status == status)
    return db.scalars(query.order_by(Request.updated_at.desc()).limit(200)).all()


@app.post("/requests", status_code=201)
def create_request(
    body: RequestInput,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = Request(**body.model_dump(), customer_id=user.id)
    db.add(item)
    db.commit()
    return item


@app.get("/requests/{request_id}")
def get_request(
    request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    return request_for(db, request_id, user)


@app.patch("/requests/{request_id}")
def edit_request(
    request_id: int,
    body: RequestInput,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = request_for(db, request_id, user)
    if user.role == "customer" and item.status != "new":
        raise HTTPException(409, "Only new requests can be edited by customers")
    item.title, item.description = body.title, body.description
    db.commit()
    return item


@app.delete("/requests/{request_id}", status_code=204)
def delete_request(
    request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    item = request_for(db, request_id, user)
    if user.role == "customer" and item.status != "new":
        raise HTTPException(409, "Only new requests can be deleted by customers")
    attachments = db.scalars(
        select(Attachment).where(Attachment.request_id == item.id)
    ).all()
    for attachment in attachments:
        db.delete(attachment)
    db.delete(item)
    db.commit()
    for attachment in attachments:
        (Path(settings.upload_dir) / attachment.storage_key).unlink(missing_ok=True)


@app.patch("/requests/{request_id}/status")
def update_status(
    request_id: int,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if user.role == "customer":
        raise HTTPException(403, "Agent role required")
    item = db.scalar(select(Request).where(Request.id == request_id).with_for_update())
    if not item:
        raise HTTPException(404, "Request not found")
    allowed = {
        "new": ["in_progress"],
        "in_progress": ["done", "rejected"],
        "done": [],
        "rejected": [],
    }
    if body.status not in allowed[item.status]:
        raise HTTPException(409, "Invalid status transition")
    previous = item.status
    item.status = body.status
    enqueue(db, item, previous)
    db.commit()
    # Redis is a notification hint; database polling guarantees delivery even if it is unavailable.
    try:
        redis.Redis.from_url(
            settings.redis_url, socket_connect_timeout=0.2, socket_timeout=0.2
        ).publish("relaydesk:deliveries", str(item.id))
    except redis.RedisError:
        pass
    return item


@app.get("/requests/{request_id}/attachments")
def attachments(
    request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    request_for(db, request_id, user)
    return [
        {
            "id": item.id,
            "filename": item.filename,
            "size": item.size,
            "content_type": item.content_type,
        }
        for item in db.scalars(
            select(Attachment).where(Attachment.request_id == request_id)
        )
    ]


@app.post("/requests/{request_id}/attachments", status_code=201)
async def upload(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    request_for(db, request_id, user)
    allowed = {
        "text/plain": [".txt"],
        "application/pdf": [".pdf"],
        "image/png": [".png"],
        "image/jpeg": [".jpg", ".jpeg"],
    }
    filename = Path((file.filename or "file").replace("\\", "/")).name[:255]
    if (
        file.content_type not in allowed
        or Path(filename).suffix.lower() not in allowed[file.content_type]
    ):
        raise HTTPException(415, "Allowed: TXT, PDF, PNG and JPEG")
    data = await file.read(settings.max_upload_bytes + 1)
    await file.close()
    if not data or len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "File must be between 1 byte and 5 MiB")
    signatures = {
        "application/pdf": b"%PDF-",
        "image/png": b"\x89PNG\r\n\x1a\n",
        "image/jpeg": b"\xff\xd8\xff",
    }
    if file.content_type in signatures and not data.startswith(
        signatures[file.content_type]
    ):
        raise HTTPException(415, "File content does not match its type")
    if file.content_type == "text/plain":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(415, "Text must be UTF-8")
    key = uuid.uuid4().hex
    directory = Path(settings.upload_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / key
    path.write_bytes(data)
    item = Attachment(
        request_id=request_id,
        filename=filename,
        storage_key=key,
        content_type=file.content_type,
        size=len(data),
    )
    db.add(item)
    try:
        db.commit()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {"id": item.id, "filename": item.filename, "size": item.size}


@app.get("/attachments/{attachment_id}")
def download(
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = db.get(Attachment, attachment_id)
    if not item:
        raise HTTPException(404, "Attachment not found")
    request_for(db, item.request_id, user)
    return FileResponse(
        Path(settings.upload_dir) / item.storage_key,
        filename=item.filename,
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.get("/webhooks")
def subscriptions(db: Session = Depends(get_db), user: User = Depends(admin)):
    return [
        subscription_out(item)
        for item in db.scalars(select(Subscription).order_by(Subscription.id))
    ]


@app.post("/webhooks", status_code=201)
def subscribe(
    body: SubscriptionInput, db: Session = Depends(get_db), user: User = Depends(admin)
):
    try:
        validate_url(body.url)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    item = Subscription(**body.model_dump())
    db.add(item)
    db.commit()
    return subscription_out(item)


@app.delete("/webhooks/{subscription_id}", status_code=204)
def unsubscribe(
    subscription_id: int, db: Session = Depends(get_db), user: User = Depends(admin)
):
    item = db.get(Subscription, subscription_id)
    if not item:
        raise HTTPException(404, "Subscription not found")
    item.active = False
    db.commit()


@app.get("/webhooks/deliveries")
def deliveries(db: Session = Depends(get_db), user: User = Depends(admin)):
    return db.scalars(select(Delivery).order_by(Delivery.id.desc()).limit(100)).all()
