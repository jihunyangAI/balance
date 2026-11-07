import { NextRequest, NextResponse } from "next/server";
import {
  getDbPool,
  generateRoomCode,
  cleanupExpiredWaitingRooms,
} from "@/lib/db";
import { verifyRequestUser } from "@/lib/auth";

// GET /api/rooms?code=A387 — 특정 방 코드 조회 (조회 전 10분 경과 빈 방 자동 정리)
export async function GET(req: NextRequest) {
  try {
    await cleanupExpiredWaitingRooms();

    const { searchParams } = new URL(req.url);
    const rawCode = searchParams.get("code") || "";
    const roomCode = rawCode.trim().toUpperCase();

    if (!roomCode || roomCode.length !== 4) {
      return NextResponse.json(
        { error: "존재하지 않는 방입니다" },
        { status: 404 }
      );
    }

    const pool = getDbPool();
    const result = await pool.query(
      `SELECT id, room_code, status, current_question, host_user_id, guest_user_id, created_at
       FROM public.rooms
       WHERE UPPER(room_code) = $1
       LIMIT 1`,
      [roomCode]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "존재하지 않는 방입니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ room: result.rows[0] });
  } catch (err) {
    console.error("GET /api/rooms error:", err);
    return NextResponse.json(
      { error: "방 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST /api/rooms — 방 만들기 (action: "create") 또는 방 참가하기 (action: "join")
export async function POST(req: NextRequest) {
  try {
    await cleanupExpiredWaitingRooms();

    const user = await verifyRequestUser(req);
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "create";
    const pool = getDbPool();

    if (action === "join") {
      const rawCode = typeof body.roomCode === "string" ? body.roomCode : "";
      const roomCode = rawCode.trim().toUpperCase();

      if (!roomCode || roomCode.length !== 4) {
        return NextResponse.json(
          { error: "존재하지 않는 방입니다" },
          { status: 404 }
        );
      }

      // 1. rooms 테이블에서 해당 코드 조회
      const existing = await pool.query(
        `SELECT id, room_code, status, current_question, created_at
         FROM public.rooms
         WHERE UPPER(room_code) = $1
         LIMIT 1`,
        [roomCode]
      );

      if (existing.rowCount === 0) {
        return NextResponse.json(
          { error: "존재하지 않는 방입니다" },
          { status: 404 }
        );
      }

      // 2. 방이 존재하면 방 정보 상태(status)를 '진행중'으로 업데이트하고 guest_user_id 기록
      const updated = await pool.query(
        `UPDATE public.rooms
         SET status = '진행중', guest_user_id = $2
         WHERE id = $1
         RETURNING id, room_code, status, current_question, host_user_id, guest_user_id, created_at`,
        [existing.rows[0].id, user.id]
      );

      return NextResponse.json({
        room: updated.rows[0],
        player: "player2",
      });
    }

    // action === "create": 랜덤 4자리 코드 생성 후 rooms 테이블에 '대기' 상태로 저장 + host_user_id 기록
    let createdRoom = null;
    const requestedCode =
      typeof body.roomCode === "string" && body.roomCode.trim().length === 4
        ? body.roomCode.trim().toUpperCase()
        : null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidateCode =
        attempt === 0 && requestedCode ? requestedCode : generateRoomCode();

      try {
        const insertRes = await pool.query(
          `INSERT INTO public.rooms (room_code, status, current_question, host_user_id)
           VALUES ($1, '대기', 1, $2)
           RETURNING id, room_code, status, current_question, host_user_id, guest_user_id, created_at`,
          [candidateCode, user.id]
        );
        createdRoom = insertRes.rows[0];
        break;
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === "23505") {
          continue;
        }
        throw err;
      }
    }

    if (!createdRoom) {
      return NextResponse.json(
        { error: "방 코드 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      room: createdRoom,
      player: "player1",
    });
  } catch (err) {
    console.error("POST /api/rooms error:", err);
    return NextResponse.json(
      { error: "방 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// DELETE /api/rooms?code=A387 — 대기 중인 빈 방 삭제
export async function DELETE(req: NextRequest) {
  try {
    await cleanupExpiredWaitingRooms();

    const { searchParams } = new URL(req.url);
    const rawCode = searchParams.get("code") || "";
    const roomCode = rawCode.trim().toUpperCase();

    if (roomCode && roomCode.length === 4) {
      const pool = getDbPool();
      await pool.query(
        `DELETE FROM public.rooms
         WHERE UPPER(room_code) = $1
           AND status IN ('대기', 'waiting')`,
        [roomCode]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/rooms error:", err);
    return NextResponse.json(
      { error: "방 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
