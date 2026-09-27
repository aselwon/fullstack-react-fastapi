from sqlalchemy import select
from .auth import passwords
from .db import SessionLocal
from .models import User, Request, Subscription


def seed():
    with SessionLocal() as db:
        for role, name in [
            ("admin", "Alex Morgan"),
            ("agent", "Jamie Chen"),
            ("customer", "Taylor Brooks"),
        ]:
            email = f"{role}@relaydesk.local"
            if not db.scalar(select(User).where(User.email == email)):
                db.add(
                    User(
                        email=email,
                        name=name,
                        role=role,
                        password_hash=passwords.hash("RelayDesk123!"),
                    )
                )
        db.flush()
        customer = db.scalar(
            select(User).where(User.email == "customer@relaydesk.local")
        )
        if not db.scalar(select(Request.id).limit(1)):
            db.add_all(
                [
                    Request(
                        title="Update our workspace billing contact",
                        description="Please change the billing contact for our team. I can provide the new details securely.",
                        customer_id=customer.id,
                    ),
                    Request(
                        title="Export includes duplicate rows",
                        description="The monthly export contains duplicate entries. Could you take a look?",
                        customer_id=customer.id,
                        status="in_progress",
                    ),
                    Request(
                        title="Help onboarding our new team",
                        description="We would love a quick guide to getting started.",
                        customer_id=customer.id,
                        status="done",
                    ),
                ]
            )
        if not db.scalar(select(Subscription.id).limit(1)):
            db.add(
                Subscription(
                    url="http://webhook-sink:8080/events",
                    secret="demo-webhook-secret-change-me",
                )
            )
        db.commit()


if __name__ == "__main__":
    seed()
