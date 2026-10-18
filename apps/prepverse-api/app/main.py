from __future__ import annotations

import json
import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, SessionLocal, engine, get_db
from app.documents import extract_text
from app.models import Activity, FocusSession, Material, Mistake, PlannerBlock, PracticeSet, RoomInvite, RoomJoinRequest, RoomMember, RoomMessage, StudyRoom, Subject, TeachBackSet, Topic, TutorMessage, User, VoiceNote, XPLedger

API = "/api/v1"
ALGORITHM = "HS256"
pwd = PasswordHash.recommended()
app = FastAPI(title="PrepVerse AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.on_event("startup")
def initialize_database() -> None:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if engine.dialect.name == "sqlite" and engine.url.database not in (None, ":memory:"):
        Path(engine.url.database).parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    # Backfill existing room links into the expiring invite system without
    # changing or deleting existing room memberships and chat history.
    with SessionLocal() as db:
        for room in db.scalars(select(StudyRoom)):
            existing = db.scalar(select(RoomInvite.id).where(RoomInvite.invite_code == room.invite_code))
            if not existing:
                db.add(RoomInvite(
                    room_id=room.id,
                    invite_code=room.invite_code,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=7),
                    approval_required=True,
                ))
        db.commit()


class AccountInput(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr | None = None
    password: str = Field(min_length=10, max_length=128)
    remember_me: bool = True


class LoginInput(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = True


class OnboardingInput(BaseModel):
    college: str = Field(min_length=1, max_length=140)
    course: str = Field(min_length=1, max_length=140)
    semester: int = Field(ge=1, le=20)
    domain: str = Field(min_length=1, max_length=120)


class SubjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=140)


class TopicInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    subject_id: str | None = None
    mode: str = Field(default="learn", pattern="^(learn|hint|socratic|exam)$")


class PinInput(BaseModel):
    pinned: bool


class PlannerInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    subject_id: str | None = None
    starts_at: datetime
    duration_minutes: int = Field(ge=5, le=600)


class ExamDateInput(BaseModel):
    exam_date: date | None = None


class PlannerDraftInput(BaseModel):
    blocks: list[PlannerInput] = Field(min_length=1, max_length=30)


class FocusStartInput(BaseModel):
    subject: str = Field(default="", max_length=140)
    topic: str = Field(default="", max_length=180)
    duration_minutes: int = Field(ge=5, le=600)


class PracticeSubmitInput(BaseModel):
    answers: list[int] = Field(min_length=15, max_length=15)


class TeachBackSubmitInput(BaseModel):
    answers: list[str] = Field(min_length=10, max_length=10)


class RoomInput(BaseModel):
    name: str = Field(min_length=2, max_length=90)
    subject: str = Field(min_length=1, max_length=140)
    approval_required: bool = True
    expires_in_hours: int = Field(default=168, ge=1, le=720)


class RoomInvitePolicyInput(BaseModel):
    approval_required: bool = True
    expires_in_hours: int = Field(default=168, ge=1, le=720)


class RoomJoinDecisionInput(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")


class RoomMessageInput(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class AIConsentInput(BaseModel):
    enabled: bool


def _issue_session(user: User, response: Response, remember: bool = True) -> None:
    duration = timedelta(days=30 if remember else 1)
    token = jwt.encode({"sub": user.id, "exp": datetime.now(timezone.utc) + duration}, settings.jwt_secret, algorithm=ALGORITHM)
    response.set_cookie(
        settings.cookie_name, token, max_age=int(duration.total_seconds()), httponly=True,
        secure=settings.cookie_secure, samesite="lax", path="/",
    )


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    try:
        user_id = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM]).get("sub")
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Please sign in again.") from exc
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found. Please sign in again.")
    return user


def _safe_user(user: User) -> dict:
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "email": user.email, "ai_data_consent": user.ai_data_consent, "xp_balance": user.xp_balance}


def _user_subjects(db: Session, user: User) -> list[Subject]:
    return list(db.scalars(select(Subject).where(Subject.user_id == user.id).order_by(Subject.name)))


def _subject_for_user(db: Session, user: User, subject_id: str) -> Subject:
    row = db.scalar(select(Subject).where(Subject.id == subject_id, Subject.user_id == user.id))
    if not row:
        raise HTTPException(404, "Subject not found in your account.")
    return row


def _add_xp(db: Session, user: User, amount: int, reason: str, ref: str) -> None:
    if amount == 0:
        return
    db.add(XPLedger(user_id=user.id, amount=amount, reason=reason, reference_id=ref))
    user.xp_balance += amount


def _apply_daily_login(db: Session, user: User) -> int:
    today = datetime.now(timezone.utc).date()
    if user.last_login_reward == today:
        return 0
    user.last_login_reward = today
    _add_xp(db, user, 5, "daily_login", today.isoformat())
    return 5


def _daily_quest_state(db: Session, user: User) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    definitions = [
        ("focus", "Complete a focus session", "focus"),
        ("tutor", "Study one topic with Drift AI", "tutor"),
        ("practice", "Complete a practice set", "practice"),
    ]
    quests = []
    for key, title, kind in definitions:
        count = db.scalar(select(func.count(Activity.id)).where(Activity.user_id == user.id, Activity.kind == kind, Activity.created_at >= start)) or 0
        quests.append({"id": key, "title": title, "progress": min(1, int(count)), "target": 1, "xp_reward": 10})
    return quests


def _award_completed_quests(db: Session, user: User) -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    for quest in _daily_quest_state(db, user):
        if quest["progress"] < quest["target"]:
            continue
        reference = f"quest:{today}:{quest['id']}"
        if not db.scalar(select(XPLedger.id).where(XPLedger.user_id == user.id, XPLedger.reference_id == reference)):
            _add_xp(db, user, quest["xp_reward"], "daily_quest", reference)


async def _gemini(prompt: str, *, json_output: bool = False) -> str:
    if not settings.gemini_api_key:
        raise HTTPException(503, "Drift AI needs a Gemini API key before it can answer. Add PREPVERSE_GEMINI_API_KEY to the service configuration.")
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)
    config = types.GenerateContentConfig(response_mime_type="application/json") if json_output else None
    try:
        result = await client.aio.models.generate_content(model=settings.gemini_model, contents=prompt, config=config)
    except Exception as exc:
        raise HTTPException(502, "Drift AI could not reach the configured Gemini service. Please retry shortly.") from exc
    if not result.text:
        raise HTTPException(502, "The AI provider returned an empty response. Please retry.")
    return result.text


@app.get(API + "/health")
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(select(1))
    except Exception as exc:
        raise HTTPException(503, "PrepVerse database is unavailable.") from exc
    return {"status": "ok", "service": "prepverse-api", "ai_configured": bool(settings.gemini_api_key)}


@app.post(API + "/auth/register", status_code=201)
def register(payload: AccountInput, response: Response, db: Session = Depends(get_db)) -> dict:
    if not payload.email:
        raise HTTPException(422, "An email address is required to create an account.")
    user = User(email=str(payload.email).lower(), username=payload.username.strip(), password_hash=pwd.hash(payload.password), display_name=payload.username.strip())
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "That email or username is already connected to a PrepVerse account.") from exc
    db.refresh(user)
    reward = _apply_daily_login(db, user)
    db.commit()
    _issue_session(user, response, payload.remember_me)
    return {"user": _safe_user(user), "onboarding_required": True, "daily_login_xp": reward, "xp_balance": user.xp_balance}


@app.post(API + "/auth/login")
def login(payload: LoginInput, response: Response, db: Session = Depends(get_db)) -> dict:
    identifier = payload.identifier.strip().lower()
    user = db.scalar(select(User).where(or_(func.lower(User.username) == identifier, func.lower(User.email) == identifier)))
    if not user or not user.password_hash or not pwd.verify(payload.password, user.password_hash):
        raise HTTPException(401, "Username or password did not match.")
    reward = _apply_daily_login(db, user)
    db.commit()
    _issue_session(user, response, payload.remember_me)
    return {"user": _safe_user(user), "onboarding_required": not bool(user.college and user.course and user.semester and user.domain), "daily_login_xp": reward, "xp_balance": user.xp_balance}


@app.post(API + "/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(settings.cookie_name, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
    return {"signed_out": True}


@app.get(API + "/auth/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"user": _safe_user(user), "onboarding_required": not bool(user.college and user.course and user.semester and user.domain)}


@app.get(API + "/auth/providers")
def auth_providers() -> dict:
    return {"google": bool(settings.google_client_id and settings.google_client_secret), "github": bool(settings.github_client_id and settings.github_client_secret)}


@app.patch(API + "/settings/ai-consent")
def update_ai_consent(payload: AIConsentInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    user.ai_data_consent = payload.enabled
    user.ai_consent_at = datetime.now(timezone.utc) if payload.enabled else None
    db.commit()
    return {"ai_data_consent": user.ai_data_consent}


def _oauth_config(provider: str) -> tuple[str | None, str | None]:
    if provider == "google":
        return settings.google_client_id, settings.google_client_secret
    return settings.github_client_id, settings.github_client_secret


@app.get(API + "/auth/{provider}/start")
def oauth_start(provider: str):
    if provider not in {"google", "github"}:
        raise HTTPException(404, "That sign-in provider is not supported.")
    client_id, client_secret = _oauth_config(provider)
    if not client_id or not client_secret:
        raise HTTPException(503, f"{provider.title()} sign-in is not configured. Set the provider client ID and secret first.")
    state = secrets.token_urlsafe(32)
    callback = f"{settings.api_origin}{API}/auth/{provider}/callback"
    if provider == "google":
        params = {"client_id": client_id, "redirect_uri": callback, "response_type": "code", "scope": "openid email profile", "state": state, "prompt": "select_account"}
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    else:
        params = {"client_id": client_id, "redirect_uri": callback, "scope": "read:user user:email", "state": state}
        url = "https://github.com/login/oauth/authorize?" + urlencode(params)
    from fastapi.responses import RedirectResponse
    response = RedirectResponse(url, status_code=302)
    response.set_cookie("pv_oauth_state", state, max_age=300, httponly=True, secure=settings.cookie_secure, samesite="lax", path="/")
    return response


@app.get(API + "/auth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, code: str | None = None, state: str | None = None, error: str | None = None, db: Session = Depends(get_db)):
    from fastapi.responses import RedirectResponse
    if provider not in {"google", "github"}:
        raise HTTPException(404, "That sign-in provider is not supported.")
    if error or not code or not state or state != request.cookies.get("pv_oauth_state"):
        return RedirectResponse(f"{settings.web_origin}/login?error=provider_sign_in_cancelled", status_code=303)
    client_id, client_secret = _oauth_config(provider)
    if not client_id or not client_secret:
        return RedirectResponse(f"{settings.web_origin}/login?error=provider_sign_in_not_configured", status_code=303)
    callback = f"{settings.api_origin}{API}/auth/{provider}/callback"
    async with httpx.AsyncClient(timeout=15) as client:
        if provider == "google":
            token_response = await client.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": client_id, "client_secret": client_secret, "redirect_uri": callback, "grant_type": "authorization_code"})
            if token_response.is_error:
                return RedirectResponse(f"{settings.web_origin}/login?error=google_exchange_failed", status_code=303)
            token_data = token_response.json()
            profile_response = await client.get("https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": f"Bearer {token_data['access_token']}"})
            profile = profile_response.json() if profile_response.is_success else {}
            email = str(profile.get("email", "")).lower() if profile.get("email_verified") else ""
            display = profile.get("name") or (email.split("@")[0] if email else "")
        else:
            token_response = await client.post("https://github.com/login/oauth/access_token", headers={"Accept": "application/json"}, data={"code": code, "client_id": client_id, "client_secret": client_secret, "redirect_uri": callback})
            token_data = token_response.json()
            access_token = token_data.get("access_token")
            if not access_token:
                return RedirectResponse(f"{settings.web_origin}/login?error=github_exchange_failed", status_code=303)
            auth_headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"}
            profile_response, emails_response = await client.get("https://api.github.com/user", headers=auth_headers), await client.get("https://api.github.com/user/emails", headers=auth_headers)
            profile = profile_response.json() if profile_response.is_success else {}
            emails = emails_response.json() if emails_response.is_success else []
            email = next((str(item["email"]).lower() for item in emails if item.get("verified") and item.get("primary")), "")
            display = profile.get("name") or profile.get("login") or (email.split("@")[0] if email else "")
    if not email:
        return RedirectResponse(f"{settings.web_origin}/login?error=verified_email_required", status_code=303)
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user:
        base = re.sub(r"[^a-z0-9_.-]", "", display.lower().replace(" ", ""))[:24] or "learner"
        username = base
        while db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
            username = f"{base[:20]}-{secrets.token_hex(2)}"
        user = User(email=email, username=username, display_name=display[:80], password_hash=None)
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user:
        return RedirectResponse(f"{settings.web_origin}/login?error=account_link_failed", status_code=303)
    destination = "/dashboard" if user.college and user.course and user.domain else "/onboarding"
    _apply_daily_login(db, user)
    db.commit()
    result = RedirectResponse(f"{settings.web_origin}{destination}", status_code=303)
    _issue_session(user, result, True)
    result.delete_cookie("pv_oauth_state", path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
    return result


@app.post(API + "/onboarding")
def onboarding(payload: OnboardingInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    user.college, user.course, user.semester, user.domain = payload.college.strip(), payload.course.strip(), payload.semester, payload.domain.strip()
    user.display_name = user.display_name or user.username
    db.commit()
    return {"saved": True, "next": "/dashboard"}


@app.get(API + "/subjects")
def list_subjects(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = _user_subjects(db, user)
    return {"items": [{"id": row.id, "name": row.name, "pinned": row.pinned, "topics": [{"id": topic.id, "title": topic.title, "importance": topic.importance, "mastery": topic.mastery} for topic in db.scalars(select(Topic).where(Topic.subject_id == row.id))]} for row in rows]}


@app.post(API + "/subjects", status_code=201)
def create_subject(payload: SubjectInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    name = payload.name.strip()
    if db.scalar(select(Subject).where(Subject.user_id == user.id, func.lower(Subject.name) == name.lower())):
        raise HTTPException(409, "That subject already exists in your study space.")
    row = Subject(user_id=user.id, name=name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "pinned": row.pinned}


@app.patch(API + "/subjects/{subject_id}/pin")
def pin_subject(subject_id: str, payload: PinInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = _subject_for_user(db, user, subject_id)
    row.pinned = payload.pinned
    db.commit()
    return {"id": row.id, "pinned": row.pinned}


@app.post(API + "/subjects/{subject_id}/topics", status_code=201)
def add_topic(subject_id: str, payload: TopicInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    subject = _subject_for_user(db, user, subject_id)
    title = payload.title.strip()
    existing = db.scalar(select(Topic).where(Topic.subject_id == subject.id, func.lower(Topic.title) == title.lower()))
    if existing:
        raise HTTPException(409, "That topic is already in this subject.")
    topic = Topic(subject_id=subject.id, title=title, source="user")
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return {"id": topic.id, "title": topic.title, "importance": topic.importance}


def _classify_subject(db: Session, user: User, filename: str, relative_path: str, text: str, requested: str) -> Subject:
    subjects = _user_subjects(db, user)
    path_hint = Path(relative_path).parent.name if relative_path and "/" in relative_path else ""
    name_hint = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    haystack = f"{path_hint} {name_hint}".lower()
    for item in subjects:
        if item.name.lower() in haystack or item.name.lower() in (text[:6000].lower() if text else ""):
            return item
    if requested.strip():
        matched = next((item for item in subjects if item.name.lower() == requested.strip().lower()), None)
        if matched:
            return matched
    candidate = path_hint or (requested.strip() if requested.strip() and requested.lower() != "auto" else "") or name_hint
    candidate = re.sub(r"\s+", " ", candidate).strip()[:140]
    if not candidate or candidate.lower() in {"notes", "lecture", "document", "study material"}:
        candidate = "Unsorted materials"
    subject = db.scalar(select(Subject).where(Subject.user_id == user.id, func.lower(Subject.name) == candidate.lower()))
    if subject:
        return subject
    subject = Subject(user_id=user.id, name=candidate)
    db.add(subject)
    db.flush()
    return subject


async def _extract_topics_from_content(db: Session, user: User, subject: Subject, text: str) -> int:
    if not settings.gemini_api_key or len(text.strip()) < 100:
        return 0
    raw = await _gemini("Read this course material and extract between 3 and 12 specific concepts or topics that are explicitly taught. Return JSON {topics:[{title,importance}]}; importance must be high, medium, or foundational. Do not invent syllabus topics.\nMATERIAL:\n" + text[:24000], json_output=True)
    try:
        topics = json.loads(raw)["topics"]
        if not isinstance(topics, list) or not 3 <= len(topics) <= 12:
            return 0
        created = 0
        for item in topics:
            title = str(item.get("title", "")).strip()[:180]
            importance = str(item.get("importance", "medium")).lower()
            if not title or importance not in {"high", "medium", "foundational"}:
                continue
            exists = db.scalar(select(Topic.id).where(Topic.subject_id == subject.id, func.lower(Topic.title) == title.lower()))
            if not exists:
                db.add(Topic(subject_id=subject.id, title=title, importance=importance, source="document"))
                created += 1
        return created
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return 0


async def _ai_material_subject(db: Session, user: User, filename: str, text: str) -> Subject | None:
    if len(text.strip()) < 100:
        return None
    subjects = [item.name for item in _user_subjects(db, user)]
    raw = await _gemini("Identify the single best-fitting subject for these notes. Prefer one of the known subjects if its content matches; if none match, propose a short subject name. Also extract 3-8 actual topics covered, each with importance high, medium, or foundational. Return JSON {subject,topics:[{title,importance}]}. Classify by the note contents rather than the filename. Known subjects: " + json.dumps(subjects, ensure_ascii=False) + "\nFilename for reference only: " + filename + "\nNOTES:\n" + text[:18000], json_output=True)
    try:
        result = json.loads(raw)
        name = str(result["subject"]).strip()[:140]
        if not name:
            raise ValueError("subject was empty")
        subject = next((item for item in _user_subjects(db, user) if item.name.casefold() == name.casefold()), None)
        if not subject:
            subject = Subject(user_id=user.id, name=name)
            db.add(subject)
            db.flush()
        topics = result.get("topics", [])
        if isinstance(topics, list):
            for item in topics[:12]:
                title = str(item.get("title", "")).strip()[:180]
                importance = str(item.get("importance", "medium")).lower()
                if title and importance in {"high", "medium", "foundational"} and not db.scalar(select(Topic.id).where(Topic.subject_id == subject.id, func.lower(Topic.title) == title.casefold())):
                    db.add(Topic(subject_id=subject.id, title=title, importance=importance, source="document"))
        return subject
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Drift AI returned an invalid subject classification. The material was saved using its folder or filename as a fallback.") from exc


@app.get(API + "/study-packs")
def study_packs(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    materials = list(db.scalars(select(Material).where(Material.user_id == user.id).order_by(Material.created_at.desc())))
    topics_count = db.scalar(select(func.count(Topic.id)).join(Subject).where(Subject.user_id == user.id)) or 0
    recall_sets = db.scalars(select(TeachBackSet).where(TeachBackSet.user_id == user.id))
    recall_cards = sum(len(row.questions or []) for row in recall_sets)
    subjects = _user_subjects(db, user)
    progress_by_subject: dict[str, list[float]] = {}
    for subject_id, mastery in db.execute(
        select(Topic.subject_id, Topic.mastery)
        .join(Subject)
        .where(Subject.user_id == user.id)
    ):
        progress_by_subject.setdefault(subject_id, []).append(float(mastery))

    items = []
    for row in materials:
        topic_mastery = progress_by_subject.get(row.subject_id, [])
        mastered_topics = sum(value >= 80 for value in topic_mastery)
        items.append({
            "id": row.id,
            "filename": row.filename,
            "subject": db.get(Subject, row.subject_id).name,
            "status": row.status,
            "created_at": row.created_at.isoformat(),
            "topic_count": len(topic_mastery),
            "mastered_topics": mastered_topics,
            "progress_percent": round(sum(topic_mastery) / len(topic_mastery)) if topic_mastery else 0,
            "in_progress": bool(topic_mastery) and mastered_topics < len(topic_mastery),
        })
    return {
        "items": items,
        "subjects": [
            {
                "id": subject.id,
                "name": subject.name,
                "pinned": subject.pinned,
                "topics": [
                    {"id": topic.id, "title": topic.title, "importance": topic.importance, "mastery": topic.mastery}
                    for topic in db.scalars(select(Topic).where(Topic.subject_id == subject.id))
                ],
            }
            for subject in subjects
        ],
        "stats": {"materials": len(materials), "notes_imported": len(materials), "concepts_mapped": topics_count, "recall_cards": recall_cards},
    }


@app.post(API + "/materials", status_code=201)
async def upload_material(file: UploadFile = File(...), subject: str = Form(default="auto"), relative_path: str = Form(default=""), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    original_name = Path(file.filename or "material").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in {".pdf", ".pptx", ".docx"}:
        raise HTTPException(415, "Upload a PDF, PPTX, or DOCX study document.")
    raw = await file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(413, f"This file exceeds the {settings.max_upload_bytes // (1024 * 1024)} MB upload limit.")
    try:
        text = extract_text(original_name, raw).strip()
    except Exception as exc:
        raise HTTPException(422, "This document could not be read. Check that it is a valid PDF, PPTX, or DOCX.") from exc
    if not text:
        raise HTTPException(422, "No selectable text could be extracted. Image-only scans need OCR before they can be used by Drift AI.")
    safe_folder = re.sub(r"[^A-Za-z0-9._-]", "_", user.id)
    file_id = str(uuid4())
    target_dir = settings.upload_dir / safe_folder
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{file_id}{suffix}"
    target.write_bytes(raw)
    analysis_warning = None
    if subject.strip().lower() == "auto":
        try:
            chosen = await _ai_material_subject(db, user, original_name, text) if user.ai_data_consent else None
            if not user.ai_data_consent:
                analysis_warning = "AI content sorting is off. Enable AI data use in Settings to classify notes by their contents."
            elif len(text.strip()) < 100:
                analysis_warning = "There is not enough selectable text to classify this document by its contents. Folder and filename were used instead."
        except HTTPException as exc:
            chosen = None
            analysis_warning = exc.detail
        classification = "AI content analysis" if chosen else "folder, filename, and matching subject names"
        if not chosen:
            chosen = _classify_subject(db, user, original_name, relative_path, text, subject)
            if user.ai_data_consent and not analysis_warning:
                try:
                    await _extract_topics_from_content(db, user, chosen, text)
                except HTTPException as exc:
                    analysis_warning = analysis_warning or exc.detail
    else:
        chosen = _classify_subject(db, user, original_name, relative_path, text, subject)
        if user.ai_data_consent:
            if not settings.gemini_api_key:
                analysis_warning = "Gemini is not configured, so this material was saved without AI topic extraction."
            else:
                try:
                    await _extract_topics_from_content(db, user, chosen, text)
                except HTTPException as exc:
                    analysis_warning = exc.detail
        classification = "selected subject and extracted document content"
    row = Material(id=file_id, user_id=user.id, subject_id=chosen.id, filename=original_name, storage_path=str(target), extracted_text=text[:1_500_000], status="ready")
    db.add(row)
    db.add(Activity(user_id=user.id, kind="material", title=f"Added {original_name}", subject=chosen.name))
    db.commit()
    return {"material": {"id": row.id, "filename": row.filename, "subject": chosen.name, "status": row.status, "characters_extracted": len(text)}, "classification": classification, "warning": analysis_warning}


@app.get(API + "/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=6)
    activities = list(db.scalars(select(Activity).where(Activity.user_id == user.id, Activity.created_at >= week_ago).order_by(Activity.created_at.desc())))
    topic_rows = list(db.execute(select(Topic, Subject.name).join(Subject).where(Subject.user_id == user.id)))
    mastery = round(sum(float(topic.mastery) for topic, _ in topic_rows) / len(topic_rows)) if topic_rows else 0
    topic_by_subject: dict[str, list[Topic]] = {}
    subjects = _user_subjects(db, user)
    for topic, _ in topic_rows:
        topic_by_subject.setdefault(topic.subject_id, []).append(topic)
    pinned = []
    for sub in subjects:
        if not sub.pinned:
            continue
        topics = topic_by_subject.get(sub.id, [])
        mastered = sum(1 for item in topics if item.mastery >= 80)
        pinned.append({"id": sub.id, "name": sub.name, "completed_topics": mastered, "total_topics": len(topics), "mastery_percent": round(sum(item.mastery for item in topics) / len(topics)) if topics else 0, "popular_topics": [{"id": item.id, "title": item.title, "importance": item.importance} for item in sorted(topics, key=lambda t: (t.importance != "high", t.mastery))[:5]]})
    rhythm = [(now.date() - timedelta(days=6-i)) for i in range(7)]
    rhythm_minutes = [sum(item.minutes for item in activities if item.created_at and item.created_at.date() == day) for day in rhythm]
    study_activity_kinds = ("focus", "tutor", "practice", "teachback", "voice_note")
    daily_activity_dates = {
        item.created_at.date()
        for item in db.scalars(select(Activity).where(Activity.user_id == user.id, Activity.kind.in_(study_activity_kinds)))
        if item.created_at
    }
    streak = 0
    cursor = now.date() if now.date() in daily_activity_dates else now.date() - timedelta(days=1)
    while cursor in daily_activity_dates:
        streak += 1
        cursor -= timedelta(days=1)
    recent = [{"id": item.id, "title": item.title, "subject": item.subject or "", "occurred_at": item.created_at.isoformat(), "href": "/study-packs" if item.kind == "material" else "/focus"} for item in activities[:4]]
    today_xp = db.scalar(select(func.coalesce(func.sum(XPLedger.amount), 0)).where(XPLedger.user_id == user.id, XPLedger.created_at >= datetime.combine(now.date(), time.min, tzinfo=timezone.utc))) or 0
    focus_today = sum(item.minutes for item in db.scalars(select(Activity).where(Activity.user_id == user.id, Activity.kind == "focus", Activity.created_at >= datetime.combine(now.date(), time.min, tzinfo=timezone.utc))))
    planner = list(db.scalars(select(PlannerBlock).where(PlannerBlock.user_id == user.id, PlannerBlock.starts_at >= now).order_by(PlannerBlock.starts_at).limit(4)))
    return {"profile": {"display_name": user.display_name or user.username, "xp_balance": user.xp_balance}, "stats": {"streak_days": streak, "mastery_percent": mastery, "xp_today": int(today_xp), "focus_minutes_today": focus_today}, "pinned_subjects": pinned, "recent_activity": recent, "upcoming": [{"id": row.id, "title": row.title, "starts_at": row.starts_at.isoformat(), "subject": db.get(Subject, row.subject_id).name if row.subject_id and db.get(Subject, row.subject_id) else ""} for row in planner], "quests": _daily_quest_state(db, user), "study_rhythm_minutes": rhythm_minutes}


@app.post(API + "/tutor/chat")
async def tutor_chat(payload: ChatInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before sending study notes or questions to Gemini.")
    query = select(Material).where(Material.user_id == user.id)
    if payload.subject_id:
        sub = _subject_for_user(db, user, payload.subject_id)
        query = query.where(Material.subject_id == sub.id)
    documents = list(db.scalars(query.order_by(Material.created_at.desc()).limit(8)))
    if not documents:
        raise HTTPException(409, "Add study material for this account before asking Drift AI for a course grounded answer.")
    context = "\n\n".join(f"SOURCE: {item.filename}\nSUBJECT: {db.get(Subject, item.subject_id).name}\nNOTES:\n{item.extracted_text[:12000]}" for item in documents)
    instructions = {"learn": "Explain the concept clearly in steps, then give a practical example.", "hint": "Give one progressive hint without revealing a full solution.", "socratic": "Guide the learner with a short explanation and one question to check understanding.", "exam": "Give a concise exam-style answer and list the key marking points."}[payload.mode]
    answer = await _gemini(f"You are Drift AI, a patient study tutor. Use the student's notes below as your primary source. Distinguish general knowledge from what the notes say, and say plainly if these notes do not cover the question. {instructions}\n\n{context[:80000]}\n\nQUESTION: {payload.message}")
    db.add(TutorMessage(user_id=user.id, subject_id=payload.subject_id, role="user", content=payload.message))
    db.add(TutorMessage(user_id=user.id, subject_id=payload.subject_id, role="assistant", content=answer))
    db.add(Activity(user_id=user.id, kind="tutor", title="Studied with Drift AI", subject=db.get(Subject, payload.subject_id).name if payload.subject_id else ""))
    _award_completed_quests(db, user)
    db.commit()
    return {"answer": answer, "grounded": True, "citations": [{"source": item.filename} for item in documents]}


@app.get(API + "/tutor/history")
def tutor_history(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = list(db.scalars(select(TutorMessage).where(TutorMessage.user_id == user.id).order_by(TutorMessage.created_at.desc()).limit(80)))
    rows.reverse()
    return {"items": [{"id": row.id, "role": row.role, "content": row.content, "created_at": row.created_at.isoformat()} for row in rows]}


@app.get(API + "/voice-notes")
def list_voice_notes(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = list(db.scalars(select(VoiceNote).where(VoiceNote.user_id == user.id).order_by(VoiceNote.created_at.desc()).limit(100)))
    return {"items": [{"id": row.id, "title": row.title, "transcript": row.transcript, "created_at": row.created_at.isoformat(), "audio_url": f"{API}/voice-notes/{row.id}/audio"} for row in rows]}


@app.get(API + "/voice-notes/{note_id}/audio")
def get_voice_audio(note_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from fastapi.responses import FileResponse
    note = db.scalar(select(VoiceNote).where(VoiceNote.id == note_id, VoiceNote.user_id == user.id))
    if not note or not Path(note.audio_path).is_file():
        raise HTTPException(404, "Voice note audio was not found.")
    suffix = Path(note.audio_path).suffix.lower()
    media = {".webm":"audio/webm", ".ogg":"audio/ogg", ".wav":"audio/wav", ".mp3":"audio/mpeg", ".m4a":"audio/mp4", ".aac":"audio/aac", ".flac":"audio/flac"}.get(suffix, "application/octet-stream")
    return FileResponse(note.audio_path, media_type=media)


async def _transcribe_audio(audio: UploadFile) -> tuple[str, bytes]:
    mime = (audio.content_type or "").split(";")[0]
    if mime not in {"audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/flac"}:
        raise HTTPException(415, "Use a browser recording in WebM, OGG, WAV, MP3, MP4, AAC, or FLAC format.")
    data = await audio.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "This audio recording is too large to transcribe.")
    if not data:
        raise HTTPException(422, "The audio recording is empty.")
    if not settings.gemini_api_key:
        raise HTTPException(503, "Voice transcription needs the configured Gemini API key.")
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=settings.gemini_api_key)
    try:
        result = await client.aio.models.generate_content(model=settings.gemini_model, contents=[types.Part.from_bytes(data=data, mime_type=mime), "Transcribe the speech exactly and return only the spoken words. If there is no intelligible speech, return an empty string."])
    except Exception as exc:
        raise HTTPException(502, "The audio could not be transcribed by the configured AI provider.") from exc
    transcript = (result.text or "").strip()
    if not transcript:
        raise HTTPException(422, "No intelligible speech was found in that recording.")
    return transcript, data


@app.post(API + "/voice-notes", status_code=201)
async def create_voice_note(audio: UploadFile = File(...), title: str = Form(default="Voice note"), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before sending a recording to Gemini for transcription.")
    transcript, data = await _transcribe_audio(audio)
    note_id = str(uuid4())
    target_dir = settings.upload_dir / re.sub(r"[^A-Za-z0-9._-]", "_", user.id) / "voice"
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
    target = target_dir / f"{note_id}{suffix}"
    target.write_bytes(data)
    row = VoiceNote(id=note_id, user_id=user.id, title=title.strip()[:180] or "Voice note", transcript=transcript, audio_path=str(target))
    db.add(row)
    db.add(Activity(user_id=user.id, kind="voice_note", title="Recorded a voice note"))
    db.commit()
    return {"id": row.id, "title": row.title, "transcript": row.transcript, "created_at": row.created_at.isoformat()}


@app.post(API + "/voice/tutor")
async def voice_tutor(audio: UploadFile = File(...), subject_id: str | None = Form(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before sending a recording to Gemini.")
    transcript, _ = await _transcribe_audio(audio)
    result = await tutor_chat(ChatInput(message=transcript, subject_id=subject_id), db, user)
    return {"transcript": transcript, **result}


@app.post(API + "/rewards/daily")
def daily_reward(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    awarded = _apply_daily_login(db, user)
    db.commit()
    return {"awarded": awarded, "xp_balance": user.xp_balance}


@app.post(API + "/practice/rapid-fire")
async def rapid_fire(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before creating a practice set with Gemini.")
    if user.xp_balance < 15:
        raise HTTPException(409, "You need 15 XP to start a Rapid Fire set.")
    subjects = _user_subjects(db, user)
    materials = list(db.scalars(select(Material).where(Material.user_id == user.id).order_by(Material.created_at.desc()).limit(10)))
    if not materials:
        topics = list(db.scalars(select(Topic).join(Subject).where(Subject.user_id == user.id)))
        if not topics:
            raise HTTPException(409, "Upload study material or add subject topics before creating a test.")
        source_text = "\n".join(f"Subject: {db.get(Subject, topic.subject_id).name}; topic to assess: {topic.title}" for topic in topics)
    else:
        source_text = "\n\n".join(f"{db.get(Subject, item.subject_id).name} — {item.filename}: {item.extracted_text[:10000]}" for item in materials)
    raw = await _gemini("Create exactly 15 distinct multiple choice questions based only on the study source. Return JSON with key questions, an array of objects with keys topic, prompt, choices (exactly 4 strings), answer_index (integer 0-3), explanation.\nSOURCE:\n" + source_text[:60000], json_output=True)
    try:
        parsed = json.loads(raw)
        questions = parsed["questions"]
        if len(questions) != 15 or any(len(item["choices"]) != 4 or item["answer_index"] not in range(4) for item in questions):
            raise ValueError("question structure")
        for question in questions:
            if not all(isinstance(question.get(key), str) and question[key].strip() for key in ("topic", "prompt", "explanation")):
                raise ValueError("question text")
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Drift AI returned an invalid test set. No XP was spent. Please try again.") from exc
    practice = PracticeSet(user_id=user.id, questions=questions, answers=[None] * 15)
    db.add(practice)
    db.flush()
    _add_xp(db, user, -15, "rapid_fire_entry", practice.id)
    db.commit()
    return {"id": practice.id, "cost_xp": 15, "xp_balance": user.xp_balance, "questions": [{"topic": item["topic"], "prompt": item["prompt"], "choices": item["choices"]} for item in questions]}


@app.post(API + "/practice/{practice_id}/submit")
def submit_practice(practice_id: str, payload: PracticeSubmitInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    practice = db.scalar(select(PracticeSet).where(PracticeSet.id == practice_id, PracticeSet.user_id == user.id))
    if not practice:
        raise HTTPException(404, "Practice set not found.")
    if practice.submitted_at:
        raise HTTPException(409, "This practice set has already been submitted.")
    wrong = []
    correct_count = 0
    for index, question in enumerate(practice.questions):
        choice = payload.answers[index]
        if choice not in range(4):
            raise HTTPException(422, "Every answer must select one of the four choices.")
        if choice == question["answer_index"]:
            correct_count += 1
        related = db.scalar(select(Topic).join(Subject).where(Subject.user_id == user.id, func.lower(Topic.title) == str(question["topic"]).lower()))
        if related:
            related.mastery = min(100.0, max(0.0, related.mastery + (5 if choice == question["answer_index"] else -7)))
        if choice != question["answer_index"]:
            wrong.append({"number": index + 1, "topic": question["topic"], "question": question["prompt"], "your_answer": question["choices"][choice], "correct_answer": question["choices"][question["answer_index"]], "explanation": question["explanation"]})
            db.add(Mistake(user_id=user.id, subject=question["topic"], question=question["prompt"], answer=question["choices"][choice], evaluation=question["explanation"]))
    practice.answers = payload.answers
    practice.submitted_at = datetime.now(timezone.utc)
    practice.score = correct_count
    earned = 30 if correct_count == 15 else 0
    _add_xp(db, user, earned, "rapid_fire_perfect" if earned else "rapid_fire_result", practice.id + ":reward")
    db.add(Activity(user_id=user.id, kind="practice", title="Completed a 15-question Rapid Fire test", minutes=0, xp=earned))
    _award_completed_quests(db, user)
    db.commit()
    return {"score": correct_count, "total": 15, "percentage": round(correct_count / 15 * 100), "wrong_answers": wrong, "xp_earned": earned, "xp_balance": user.xp_balance}


@app.get(API + "/practice/active")
def active_practice(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rapid = db.scalar(select(PracticeSet).where(PracticeSet.user_id == user.id, PracticeSet.submitted_at.is_(None)).order_by(PracticeSet.created_at.desc()))
    teach = db.scalar(select(TeachBackSet).where(TeachBackSet.user_id == user.id, TeachBackSet.submitted_at.is_(None)).order_by(TeachBackSet.created_at.desc()))
    return {
        "rapid_fire": ({"id": rapid.id, "questions": [{"topic": q["topic"], "prompt": q["prompt"], "choices": q["choices"]} for q in rapid.questions]} if rapid else None),
        "teach_back": ({"id": teach.id, "questions": [{"topic": q["topic"], "question": q["question"]} for q in teach.questions]} if teach else None),
    }


@app.get(API + "/mastery")
def mastery_map(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    subjects = _user_subjects(db, user)
    tree = []
    values = []
    for subject in subjects:
        topics = list(db.scalars(select(Topic).where(Topic.subject_id == subject.id).order_by(Topic.importance.desc(), Topic.title)))
        values.extend(topic.mastery for topic in topics)
        tree.append({"id": subject.id, "name": subject.name, "pinned": subject.pinned, "topics": [{"id": topic.id, "name": topic.title, "mastery": round(topic.mastery), "importance": topic.importance, "source": topic.source} for topic in topics]})
    return {"overall": round(sum(values) / len(values)) if values else 0, "subjects": tree, "tracked_topics": len(values), "empty": len(values) == 0}


@app.post(API + "/practice/teach-back", status_code=201)
async def create_teach_back(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before creating written-answer practice with Gemini.")
    materials = list(db.scalars(select(Material).where(Material.user_id == user.id).order_by(Material.created_at.desc()).limit(10)))
    topics = list(db.scalars(select(Topic).join(Subject).where(Subject.user_id == user.id)))
    if not materials and not topics:
        raise HTTPException(409, "Upload study material or add subject topics before creating written-answer practice.")
    source = "\n\n".join(f"{db.get(Subject, item.subject_id).name}: {item.extracted_text[:8000]}" for item in materials)
    if topics:
        source += "\nTopic outline:\n" + "\n".join(f"{db.get(Subject, item.subject_id).name}: {item.title}" for item in topics)
    raw = await _gemini("Create exactly 10 short-answer questions that test understanding, based only on this student's materials. Return JSON {questions:[{topic,question,expected_answer,rubric}]}. Keep expected answers and rubric short; they will only be used for private evaluation.\nSTUDY SOURCE:\n" + source[:60000], json_output=True)
    try:
        questions = json.loads(raw)["questions"]
        if len(questions) != 10 or any(not all(isinstance(item.get(key), str) and item[key].strip() for key in ("topic", "question", "expected_answer", "rubric")) for item in questions):
            raise ValueError("question structure")
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Drift AI returned an invalid written-answer set. No answers were saved.") from exc
    row = TeachBackSet(user_id=user.id, questions=questions)
    db.add(row)
    db.commit()
    return {"id": row.id, "questions": [{"topic": item["topic"], "question": item["question"]} for item in questions]}


@app.post(API + "/practice/teach-back/{set_id}/submit")
async def submit_teach_back(set_id: str, payload: TeachBackSubmitInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before asking Gemini to evaluate answers.")
    row = db.scalar(select(TeachBackSet).where(TeachBackSet.id == set_id, TeachBackSet.user_id == user.id))
    if not row:
        raise HTTPException(404, "Written-answer set not found.")
    if row.submitted_at:
        raise HTTPException(409, "This set has already been evaluated.")
    answer_list = [answer.strip()[:4000] for answer in payload.answers]
    if any(not answer for answer in answer_list):
        raise HTTPException(422, "Answer all 10 questions before asking Drift AI to evaluate them.")
    qa = [{"question": item["question"], "topic": item["topic"], "learner_answer": answer_list[index], "expected_answer": item["expected_answer"], "rubric": item["rubric"]} for index,item in enumerate(row.questions)]
    raw = await _gemini("Evaluate the learner's ten short answers against the supplied study material, expected answers, and rubric. Score each 0-5, identify what they got right, correct misunderstandings, and give one actionable improvement. Return JSON {results:[{score,feedback,correction}],overall_feedback,correct_count}. Be encouraging and precise.\n" + json.dumps(qa, ensure_ascii=False), json_output=True)
    try:
        parsed = json.loads(raw)
        results = parsed["results"]
        if len(results) != 10 or any(int(item["score"]) not in range(6) or not item.get("feedback") or not item.get("correction") for item in results):
            raise ValueError("result shape")
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Drift AI returned an invalid evaluation. Your answers remain available for retry.") from exc
    row.answers, row.results, row.submitted_at = answer_list, parsed, datetime.now(timezone.utc)
    for item, answer, result in zip(row.questions, answer_list, results):
        if int(result["score"]) < 3:
            db.add(Mistake(user_id=user.id, subject=item["topic"], question=item["question"], answer=answer, evaluation=str(result["correction"])))
    db.add(Activity(user_id=user.id, kind="teachback", title="Completed 10 written-answer questions"))
    _award_completed_quests(db, user)
    db.commit()
    return {"results": results, "overall_feedback": parsed.get("overall_feedback", ""), "correct_count": parsed.get("correct_count", sum(int(item["score"]) >= 3 for item in results))}


@app.get(API + "/mistakes")
def list_mistakes(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = list(db.scalars(select(Mistake).where(Mistake.user_id == user.id).order_by(Mistake.reviewed_at.asc().nullsfirst(), Mistake.created_at.desc())))
    return {"items": [{"id": row.id, "subject": row.subject, "question": row.question, "answer": row.answer, "evaluation": row.evaluation, "reviewed": row.reviewed_at is not None} for row in rows]}


@app.post(API + "/mistakes/{mistake_id}/review")
def review_mistake(mistake_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(Mistake).where(Mistake.id == mistake_id, Mistake.user_id == user.id))
    if not row:
        raise HTTPException(404, "Mistake not found.")
    row.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    return {"reviewed": True}


@app.get(API + "/planner")
def get_planner(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = list(db.scalars(select(PlannerBlock).where(PlannerBlock.user_id == user.id).order_by(PlannerBlock.starts_at).limit(100)))
    countdown = max(0, (user.exam_date - datetime.now(timezone.utc).date()).days) if user.exam_date else None
    return {"items": [{"id": row.id, "title": row.title, "subject_id": row.subject_id, "starts_at": row.starts_at.isoformat(), "duration_minutes": row.duration_minutes, "completed": row.completed_at is not None} for row in rows], "subjects": [{"id": row.id, "name": row.name} for row in _user_subjects(db, user)], "exam_date": user.exam_date.isoformat() if user.exam_date else None, "exam_countdown_days": countdown, "draft_pending": user.planner_draft is not None}


@app.patch(API + "/planner/exam-date")
def set_exam_date(payload: ExamDateInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    user.exam_date = payload.exam_date
    db.commit()
    countdown = max(0, (user.exam_date - datetime.now(timezone.utc).date()).days) if user.exam_date else None
    return {"exam_date": user.exam_date.isoformat() if user.exam_date else None, "exam_countdown_days": countdown}


@app.post(API + "/planner/draft")
async def draft_planner(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if user.planner_draft:
        return {**user.planner_draft, "requires_confirmation": True}
    if not user.ai_data_consent:
        raise HTTPException(403, "Turn on AI data use in Settings before asking Gemini to draft your planner.")
    subjects = _user_subjects(db, user)
    if not subjects:
        raise HTTPException(409, "Add your semester subjects before asking Drift AI to draft a study planner.")
    materials = list(db.scalars(select(Material).where(Material.user_id == user.id).order_by(Material.created_at.desc()).limit(8)))
    topic_rows = list(db.scalars(select(Topic).join(Subject).where(Subject.user_id == user.id)))
    evidence = "\n".join(f"{row.name}: " + ", ".join(topic.title for topic in topic_rows if topic.subject_id == row.id) for row in subjects)
    if materials:
        evidence += "\nUploaded sources: " + "; ".join(f"{item.filename} ({db.get(Subject, item.subject_id).name})" for item in materials)
    exam = user.exam_date.isoformat() if user.exam_date else "not provided"
    now = datetime.now(timezone.utc)
    start_day = (now + timedelta(days=1)).date()
    raw = await _gemini("Make a realistic editable 7-day study planner using only this learner's subjects and topics. Return JSON {blocks:[{title, subject, day_offset, hour_local, duration_minutes}]}. Include 1-3 blocks per study day, leave one lighter day, never invent exams. day_offset is integer 0-6 from " + start_day.isoformat() + "; hour_local is 8-21; each duration is 20-120 minutes. Semester exam date: " + exam + ". Learner timezone is Asia/Kolkata. Source topics:\n" + evidence[:12000], json_output=True)
    try:
        values = json.loads(raw)["blocks"]
        blocks = []
        for item in values:
            offset, hour, minutes = int(item["day_offset"]), int(item["hour_local"]), int(item["duration_minutes"])
            if offset not in range(7) or hour not in range(8, 22) or minutes not in range(20, 121):
                raise ValueError("planner bounds")
            subject = str(item["subject"])[:140]
            linked = next((row for row in subjects if row.name.lower() == subject.lower()), None)
            local_start = datetime.combine(start_day + timedelta(days=offset), time(hour, 0), tzinfo=timezone(timedelta(hours=5, minutes=30)))
            blocks.append({"title": str(item["title"])[:180], "subject": linked.name if linked else subject, "subject_id": linked.id if linked else None, "starts_at": local_start.isoformat(), "duration_minutes": minutes})
        if not blocks:
            raise ValueError("empty draft")
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Drift AI returned a planner in an invalid format. No study blocks were saved.") from exc
    user.planner_draft = {"blocks": blocks, "generated_at": now.isoformat()}
    db.commit()
    return {"blocks": blocks, "generated_at": now.isoformat(), "requires_confirmation": True}


@app.post(API + "/planner/draft/accept", status_code=201)
def accept_planner_draft(payload: PlannerDraftInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    for item in payload.blocks:
        if item.subject_id:
            _subject_for_user(db, user, item.subject_id)
        db.add(PlannerBlock(user_id=user.id, title=item.title.strip(), subject_id=item.subject_id, starts_at=item.starts_at, duration_minutes=item.duration_minutes))
    user.planner_draft = None
    db.commit()
    return {"saved": len(payload.blocks)}


@app.delete(API + "/planner/draft", status_code=204)
def discard_planner_draft(db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    user.planner_draft = None
    db.commit()
    return Response(status_code=204)


@app.post(API + "/planner/blocks", status_code=201)
def add_planner_block(payload: PlannerInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if payload.subject_id:
        _subject_for_user(db, user, payload.subject_id)
    row = PlannerBlock(user_id=user.id, title=payload.title.strip(), subject_id=payload.subject_id, starts_at=payload.starts_at, duration_minutes=payload.duration_minutes)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "title": row.title, "starts_at": row.starts_at.isoformat(), "duration_minutes": row.duration_minutes, "completed": False}


@app.patch(API + "/planner/blocks/{block_id}")
def edit_planner_block(block_id: str, payload: PlannerInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(PlannerBlock).where(PlannerBlock.id == block_id, PlannerBlock.user_id == user.id))
    if not row:
        raise HTTPException(404, "Study block not found.")
    if payload.subject_id:
        _subject_for_user(db, user, payload.subject_id)
    row.title, row.subject_id, row.starts_at, row.duration_minutes = payload.title.strip(), payload.subject_id, payload.starts_at, payload.duration_minutes
    db.commit()
    return {"id": row.id, "title": row.title, "starts_at": row.starts_at.isoformat(), "duration_minutes": row.duration_minutes}


@app.delete(API + "/planner/blocks/{block_id}", status_code=204)
def delete_planner_block(block_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    row = db.scalar(select(PlannerBlock).where(PlannerBlock.id == block_id, PlannerBlock.user_id == user.id))
    if not row:
        raise HTTPException(404, "Study block not found.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@app.patch(API + "/planner/blocks/{block_id}/complete")
def complete_planner_block(block_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(PlannerBlock).where(PlannerBlock.id == block_id, PlannerBlock.user_id == user.id))
    if not row:
        raise HTTPException(404, "Study block not found.")
    row.completed_at = datetime.now(timezone.utc)
    db.commit()
    return {"completed": True}


@app.post(API + "/focus/start", status_code=201)
def start_focus(payload: FocusStartInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    existing = db.scalar(select(FocusSession.id).where(FocusSession.user_id == user.id, FocusSession.completed_at.is_(None), FocusSession.cancelled_at.is_(None)))
    if existing:
        raise HTTPException(409, "You already have an active focus session. Resume it in the Focus Room or cancel it before starting another.")
    row = FocusSession(user_id=user.id, subject=payload.subject, topic=payload.topic, duration_minutes=payload.duration_minutes)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "started_at": row.started_at.isoformat(), "duration_minutes": row.duration_minutes}


@app.get(API + "/focus/active")
def active_focus(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(FocusSession).where(FocusSession.user_id == user.id, FocusSession.completed_at.is_(None), FocusSession.cancelled_at.is_(None)).order_by(FocusSession.started_at.desc()))
    if not row:
        return {"session": None}
    return {"session": {"id": row.id, "started_at": row.started_at.isoformat(), "duration_minutes": row.duration_minutes, "subject": row.subject, "topic": row.topic}}


@app.post(API + "/focus/{session_id}/cancel")
def cancel_focus(session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(FocusSession).where(FocusSession.id == session_id, FocusSession.user_id == user.id, FocusSession.completed_at.is_(None)))
    if not row:
        raise HTTPException(404, "Active focus session not found.")
    row.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    return {"cancelled": True}


@app.post(API + "/focus/{session_id}/complete")
def complete_focus(session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = db.scalar(select(FocusSession).where(FocusSession.id == session_id, FocusSession.user_id == user.id))
    if not row:
        raise HTTPException(404, "Focus session not found.")
    if row.completed_at:
        return {"completed": True, "already_completed": True}
    if row.cancelled_at:
        raise HTTPException(409, "This focus session was cancelled and cannot be completed.")
    now = datetime.now(timezone.utc)
    started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
    total_seconds = row.duration_minutes * 60 + ((row.duration_minutes - 1) // 25) * 5 * 60
    if now < started + timedelta(seconds=total_seconds):
        raise HTTPException(409, "The selected focus duration has not elapsed yet.")
    row.completed_at = now
    ref = row.id + ":focus"
    reward = min(100, row.duration_minutes // 5 * 2)
    _add_xp(db, user, reward, "focus_complete", ref)
    db.add(Activity(user_id=user.id, kind="focus", title=f"Completed a {row.duration_minutes}-minute focus session", subject=row.subject, minutes=row.duration_minutes, xp=reward))
    _award_completed_quests(db, user)
    db.commit()
    return {"completed": True, "xp_earned": reward, "xp_balance": user.xp_balance}


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _room_payload(db: Session, user: User, room: StudyRoom) -> dict:
    invite = db.scalar(select(RoomInvite).where(RoomInvite.room_id == room.id, RoomInvite.invite_code == room.invite_code))
    now = datetime.now(timezone.utc)
    invite_active = bool(invite and invite.revoked_at is None and _utc(invite.expires_at) > now)
    members = db.scalar(select(func.count(RoomMember.id)).where(RoomMember.room_id == room.id)) or 0
    pending = db.scalar(select(func.count(RoomJoinRequest.id)).where(RoomJoinRequest.room_id == room.id, RoomJoinRequest.status == "pending")) or 0
    return {
        "id": room.id,
        "name": room.name,
        "subject": room.subject,
        "invite_code": invite.invite_code if invite else "",
        "share_path": f"/rooms/join/{invite.invite_code}" if invite_active and invite else "",
        "invite_active": invite_active,
        "invite_expires_at": invite.expires_at.isoformat() if invite else None,
        "approval_required": invite.approval_required if invite else True,
        "members": members,
        "capacity": 4,
        "is_owner": room.owner_id == user.id,
        "pending_requests": int(pending) if room.owner_id == user.id else 0,
    }


def _owned_room(db: Session, user: User, room_id: str) -> StudyRoom:
    room = db.get(StudyRoom, room_id)
    if not room or room.owner_id != user.id:
        raise HTTPException(404, "Study room not found in your account.")
    return room


def _new_room_invite(db: Session, room: StudyRoom, policy: RoomInvitePolicyInput) -> RoomInvite:
    now = datetime.now(timezone.utc)
    code = secrets.token_urlsafe(12)[:16]
    invite = RoomInvite(
        room_id=room.id,
        invite_code=code,
        expires_at=now + timedelta(hours=policy.expires_in_hours),
        approval_required=policy.approval_required,
    )
    room.invite_code = code
    db.add(invite)
    return invite


@app.post(API + "/rooms", status_code=201)
def create_room(payload: RoomInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    row = StudyRoom(owner_id=user.id, name=payload.name.strip(), subject=payload.subject.strip(), invite_code=secrets.token_urlsafe(12)[:16])
    db.add(row)
    db.flush()
    db.add(RoomMember(room_id=row.id, user_id=user.id))
    policy = RoomInvitePolicyInput(approval_required=payload.approval_required, expires_in_hours=payload.expires_in_hours)
    _new_room_invite(db, row, policy)
    db.commit()
    db.refresh(row)
    return _room_payload(db, user, row)


@app.get(API + "/rooms")
def list_rooms(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = list(db.scalars(select(StudyRoom).join(RoomMember).where(RoomMember.user_id == user.id).order_by(StudyRoom.created_at.desc())))
    return {"items": [_room_payload(db, user, row) for row in rows]}


@app.post(API + "/rooms/{room_id}/invite/rotate")
def rotate_room_invite(room_id: str, payload: RoomInvitePolicyInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    room = _owned_room(db, user, room_id)
    now = datetime.now(timezone.utc)
    for invite in db.scalars(select(RoomInvite).where(RoomInvite.room_id == room.id, RoomInvite.revoked_at.is_(None))):
        invite.revoked_at = now
    _new_room_invite(db, room, payload)
    db.commit()
    db.refresh(room)
    return _room_payload(db, user, room)


@app.post(API + "/rooms/{room_id}/invite/revoke")
def revoke_room_invite(room_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    room = _owned_room(db, user, room_id)
    now = datetime.now(timezone.utc)
    for invite in db.scalars(select(RoomInvite).where(RoomInvite.room_id == room.id, RoomInvite.revoked_at.is_(None))):
        invite.revoked_at = now
    db.commit()
    return _room_payload(db, user, room)


@app.post(API + "/rooms/join/{invite_code}")
def join_room(invite_code: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    invite = db.scalar(select(RoomInvite).where(RoomInvite.invite_code == invite_code))
    if not invite or invite.revoked_at or _utc(invite.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(404, "This study room invite link is invalid, expired, or was revoked.")
    room = db.get(StudyRoom, invite.room_id)
    if not room:
        raise HTTPException(404, "This study room no longer exists.")
    existing = db.scalar(select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user.id))
    if existing:
        return {"joined": True, "room_id": room.id, "name": room.name, "subject": room.subject}
    count = db.scalar(select(func.count(RoomMember.id)).where(RoomMember.room_id == room.id)) or 0
    if count >= 4:
        raise HTTPException(409, "This study room has reached its four-person limit.")
    if invite.approval_required:
        request = db.scalar(select(RoomJoinRequest).where(RoomJoinRequest.room_id == room.id, RoomJoinRequest.user_id == user.id))
        if request and request.status == "pending":
            return {"joined": False, "pending_approval": True, "room_id": room.id, "name": room.name}
        if request and request.status == "rejected" and request.invite_id == invite.id:
            raise HTTPException(403, "The host declined this request. Ask them for a new invite before requesting again.")
        now = datetime.now(timezone.utc)
        if request:
            request.invite_id, request.status, request.requested_at, request.reviewed_at, request.reviewed_by = invite.id, "pending", now, None, None
        else:
            db.add(RoomJoinRequest(room_id=room.id, user_id=user.id, invite_id=invite.id, status="pending"))
        db.commit()
        return {"joined": False, "pending_approval": True, "room_id": room.id, "name": room.name}
    db.add(RoomMember(room_id=room.id, user_id=user.id))
    request = db.scalar(select(RoomJoinRequest).where(RoomJoinRequest.room_id == room.id, RoomJoinRequest.user_id == user.id))
    if request:
        request.status, request.reviewed_at = "approved", datetime.now(timezone.utc)
    db.commit()
    return {"joined": True, "room_id": room.id, "name": room.name, "subject": room.subject}


@app.get(API + "/rooms/{room_id}/join-requests")
def list_room_join_requests(room_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    room = _owned_room(db, user, room_id)
    rows = db.execute(select(RoomJoinRequest, User.username).join(User, User.id == RoomJoinRequest.user_id).where(RoomJoinRequest.room_id == room.id, RoomJoinRequest.status == "pending").order_by(RoomJoinRequest.requested_at)).all()
    return {"items": [{"id": item.id, "username": username, "requested_at": item.requested_at.isoformat()} for item, username in rows]}


@app.post(API + "/rooms/{room_id}/join-requests/{request_id}")
def decide_room_join_request(room_id: str, request_id: str, payload: RoomJoinDecisionInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    room = _owned_room(db, user, room_id)
    request = db.scalar(select(RoomJoinRequest).where(RoomJoinRequest.id == request_id, RoomJoinRequest.room_id == room.id, RoomJoinRequest.status == "pending"))
    if not request:
        raise HTTPException(404, "Pending join request not found.")
    if payload.decision == "approve":
        count = db.scalar(select(func.count(RoomMember.id)).where(RoomMember.room_id == room.id)) or 0
        if count >= 4:
            raise HTTPException(409, "The room is full. Remove a member before approving another request.")
        if not db.scalar(select(RoomMember.id).where(RoomMember.room_id == room.id, RoomMember.user_id == request.user_id)):
            db.add(RoomMember(room_id=room.id, user_id=request.user_id))
        request.status = "approved"
    else:
        request.status = "rejected"
    request.reviewed_at, request.reviewed_by = datetime.now(timezone.utc), user.id
    db.commit()
    return {"status": request.status}


def _room_for_member(db: Session, user: User, room_id: str) -> StudyRoom:
    room = db.scalar(select(StudyRoom).join(RoomMember).where(StudyRoom.id == room_id, RoomMember.user_id == user.id))
    if not room:
        raise HTTPException(404, "Study room not found in your account.")
    return room


@app.get(API + "/rooms/{room_id}/messages")
def room_messages(room_id: str, after: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    _room_for_member(db, user, room_id)
    query = select(RoomMessage, User.username).join(User, User.id == RoomMessage.user_id).where(RoomMessage.room_id == room_id)
    if after:
        try:
            after_dt = datetime.fromisoformat(after)
        except ValueError as exc:
            raise HTTPException(422, "Invalid message cursor.") from exc
            # Use an inclusive cursor so messages saved within the same
            # database timestamp interval are not skipped. The client merges
            # overlapping results by message ID.
            query = query.where(RoomMessage.created_at >= after_dt)
    rows = db.execute(query.order_by(RoomMessage.created_at.desc(), RoomMessage.id.desc()).limit(100)).all()
    rows.reverse()
    return {"items": [{"id": item.id, "username": username, "body": item.body, "created_at": item.created_at.isoformat()} for item, username in rows]}


@app.post(API + "/rooms/{room_id}/messages", status_code=201)
def post_room_message(room_id: str, payload: RoomMessageInput, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    _room_for_member(db, user, room_id)
    row = RoomMessage(room_id=room_id, user_id=user.id, body=payload.body.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "username": user.username, "body": row.body, "created_at": row.created_at.isoformat()}


@app.get(API + "/wrapped")
def wrapped(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    start = datetime.now(timezone.utc) - timedelta(days=30)
    rows = list(db.scalars(select(Activity).where(Activity.user_id == user.id, Activity.created_at >= start)))
    by_subject: dict[str, int] = {}
    for row in rows:
        if row.subject:
            by_subject[row.subject] = by_subject.get(row.subject, 0) + row.minutes
    return {"period_days": 30, "focus_minutes": sum(row.minutes for row in rows), "active_days": len({row.created_at.date() for row in rows if row.created_at}), "xp_earned": sum(max(0, row.xp) for row in rows), "activity_count": len(rows), "subjects": [{"name": name, "minutes": minutes} for name, minutes in sorted(by_subject.items(), key=lambda pair: pair[1], reverse=True)], "empty": len(rows) == 0}

