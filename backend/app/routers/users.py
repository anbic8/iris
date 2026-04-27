import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth import get_current_user, hash_password, require_admin, verify_password
from app.database import get_db
from app.models import User

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    name: str | None = None
    max_hr: int | None = None
    hr_zones: list[int] | None = None
    birth_year: int | None = None
    weight_kg: float | None = None
    password: str | None = None


@router.post("/login")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    request.session["user_id"] = user.id
    return {"id": user.id, "name": user.name, "email": user.email, "is_admin": user.is_admin}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"detail": "Logged out"}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
        "max_hr": current_user.max_hr,
        "hr_zones": json.loads(current_user.hr_zones) if current_user.hr_zones else None,
    }


@router.patch("/me")
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.name is not None:
        current_user.name = data.name
    if data.max_hr is not None:
        current_user.max_hr = data.max_hr
    if data.hr_zones is not None:
        current_user.hr_zones = json.dumps(data.hr_zones)
    if data.birth_year is not None:
        current_user.birth_year = data.birth_year
    if data.weight_kg is not None:
        current_user.weight_kg = data.weight_kg
    if data.password is not None:
        current_user.password_hash = hash_password(data.password)
    db.commit()
    return {"detail": "Updated"}


@router.post("/", dependencies=[Depends(require_admin)], status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(name=data.name, email=data.email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "name": user.name, "email": user.email}
