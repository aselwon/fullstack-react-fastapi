from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from .models import User

passwords = PasswordHash.recommended()
bearer = HTTPBearer()


def token_for(user):
    return jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(hours=8)},
        settings.jwt_secret,
        algorithm="HS256",
    )


def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=["HS256"]
        )
        user = db.get(User, int(payload["sub"]))
        if not user:
            raise ValueError()
        return user
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(401, "Invalid or expired session")


def admin(user: User = Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Administrator role required")
    return user
