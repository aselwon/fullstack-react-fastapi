from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["admin", "agent", "customer"]
Status = Literal["new", "in_progress", "done", "rejected"]


class Login(BaseModel):
    email: str
    password: str


class UserCreate(Login):
    name: str = Field(min_length=1, max_length=100)
    role: Role = "customer"
    password: str = Field(min_length=10, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if "@" not in value or len(value) > 254:
            raise ValueError("Valid email required")
        return value


class RoleUpdate(BaseModel):
    role: Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: Role


class RequestInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)

    @field_validator("title", "description")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Cannot be blank")
        return value.strip()


class StatusUpdate(BaseModel):
    status: Status


class SubscriptionInput(BaseModel):
    url: str = Field(max_length=2048)
    secret: str = Field(min_length=16, max_length=200)
    active: bool = True
