import json
from contextlib import aclosing

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.career_coach import CoachConversation, CoachMessage
from app.modules.career_coach import chat, ratelimit
from app.modules.events.router import format_sse
from app.schemas.career_coach import CoachMessageSchema, ConversationSchema, SendMessageRequestSchema

router = APIRouter()


def _owned_conversation(db: Session, user_id: str, conversation_id: int) -> CoachConversation | None:
    return (
        db.query(CoachConversation)
        .filter(CoachConversation.id == conversation_id, CoachConversation.user_id == user_id)
        .first()
    )


def _serialize_conversation(row: CoachConversation) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _serialize_message(row: CoachMessage) -> dict:
    return {
        "id": row.id,
        "role": row.role,
        "content": row.content,
        "follow_ups": json.loads(row.follow_ups) if row.follow_ups else [],
        "created_at": row.created_at.isoformat(),
    }


@router.get("/conversations", response_model=list[ConversationSchema])
def list_conversations(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)):
    rows = (
        db.query(CoachConversation)
        .filter(CoachConversation.user_id == current_user.id)
        .order_by(CoachConversation.updated_at.desc(), CoachConversation.id.desc())
        .all()
    )
    return [_serialize_conversation(r) for r in rows]


@router.post("/conversations", response_model=ConversationSchema, status_code=201)
def create_conversation(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)):
    row = CoachConversation(user_id=current_user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_conversation(row)


@router.get("/conversations/{conversation_id}/messages", response_model=list[CoachMessageSchema])
def list_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    if not _owned_conversation(db, current_user.id, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conversation_id)
        .order_by(CoachMessage.created_at.asc())
        .all()
    )
    return [_serialize_message(r) for r in rows]


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = _owned_conversation(db, current_user.id, conversation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(row)  # cascades to coach_messages
    db.commit()


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: int,
    payload: SendMessageRequestSchema,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Streams the assistant's reply over SSE — same wire format and
    transport choice as /api/events/stream (hand-rolled StreamingResponse,
    Bearer auth, so the frontend uses the same fetch-based reader rather than
    EventSource). Unlike that endpoint this is a one-shot request/response,
    not a long-lived subscription: it ends when the reply finishes.

    Uses its own DB session inside the generator rather than the
    Depends(get_db) session above, which is torn down as soon as this
    function returns the StreamingResponse — before the stream body has
    actually run.
    """
    if not _owned_conversation(db, current_user.id, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if not ratelimit.check_rate_limit(current_user.id):
        raise HTTPException(status_code=429, detail="Too many messages — please wait a moment before sending another.")

    async def event_stream():
        stream_db = SessionLocal()
        try:
            conversation = _owned_conversation(stream_db, current_user.id, conversation_id)
            if not conversation:
                yield format_sse("error", {"message": "Conversation not found"})
                yield format_sse("done", {})
                return
            # aclosing, not a bare async-for-with-break: breaking out of an
            # async generator does not deterministically call its aclose()
            # (only eventual GC would), and chat.stream_reply's own cleanup
            # — persisting whatever text was generated so far — needs to run
            # synchronously, before stream_db.close() below.
            async with aclosing(chat.stream_reply(stream_db, conversation, message)) as events:
                async for event in events:
                    if await request.is_disconnected():
                        break
                    event_type = event.pop("type")
                    yield format_sse(event_type, event)
        finally:
            stream_db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
