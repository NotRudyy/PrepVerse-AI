from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uid() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "pv_users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(80), default="Learner")
    college: Mapped[str] = mapped_column(String(140), default="")
    course: Mapped[str] = mapped_column(String(140), default="")
    semester: Mapped[int] = mapped_column(Integer, default=1)
    domain: Mapped[str] = mapped_column(String(120), default="")
    exam_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    ai_data_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planner_draft: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    xp_balance: Mapped[int] = mapped_column(Integer, default=0)
    last_login_reward: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    subjects: Mapped[list["Subject"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Subject(Base):
    __tablename__ = "pv_subjects"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_pv_subject_user_name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(140))
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    owner: Mapped[User] = relationship(back_populates="subjects")


class Topic(Base):
    __tablename__ = "pv_topics"
    __table_args__ = (UniqueConstraint("subject_id", "title", name="uq_pv_topic_subject_title"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    subject_id: Mapped[str] = mapped_column(ForeignKey("pv_subjects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    importance: Mapped[str] = mapped_column(String(16), default="medium")
    mastery: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String(24), default="user")


class Material(Base):
    __tablename__ = "pv_materials"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("pv_subjects.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(Text)
    file_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Activity(Base):
    __tablename__ = "pv_activities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(180))
    subject: Mapped[str] = mapped_column(String(140), default="")
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PlannerBlock(Base):
    __tablename__ = "pv_planner_blocks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[str | None] = mapped_column(ForeignKey("pv_subjects.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(180))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Mistake(Base):
    __tablename__ = "pv_mistakes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(140))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    evaluation: Mapped[str] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class XPLedger(Base):
    __tablename__ = "pv_xp_ledger"
    __table_args__ = (UniqueConstraint("user_id", "reference_id", name="uq_pv_xp_reference"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(48))
    reference_id: Mapped[str] = mapped_column(String(72))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PracticeSet(Base):
    __tablename__ = "pv_practice_sets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    questions: Mapped[list[dict]] = mapped_column(JSON)
    answers: Mapped[list[int | None]] = mapped_column(JSON, default=list)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeachBackSet(Base):
    __tablename__ = "pv_teachback_sets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    questions: Mapped[list[dict]] = mapped_column(JSON)
    answers: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FocusSession(Base):
    __tablename__ = "pv_focus_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(140), default="")
    topic: Mapped[str] = mapped_column(String(180), default="")
    duration_minutes: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudyRoom(Base):
    __tablename__ = "pv_rooms"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(90))
    subject: Mapped[str] = mapped_column(String(140))
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoomInvite(Base):
    __tablename__ = "pv_room_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("pv_rooms.id", ondelete="CASCADE"), index=True)
    invite_code: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoomJoinRequest(Base):
    __tablename__ = "pv_room_join_requests"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_pv_room_join_request"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("pv_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    invite_id: Mapped[str] = mapped_column(ForeignKey("pv_room_invites.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("pv_users.id", ondelete="SET NULL"), nullable=True)


class RoomMember(Base):
    __tablename__ = "pv_room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_pv_room_member"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("pv_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoomMessage(Base):
    __tablename__ = "pv_room_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("pv_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class TutorMessage(Base):
    __tablename__ = "pv_tutor_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[str | None] = mapped_column(ForeignKey("pv_subjects.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String(12))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class VoiceNote(Base):
    __tablename__ = "pv_voice_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("pv_users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    transcript: Mapped[str] = mapped_column(Text)
    audio_path: Mapped[str] = mapped_column(Text)
    audio_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

