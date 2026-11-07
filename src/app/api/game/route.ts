import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { verifyRequestUser } from "@/lib/auth";
import fs from "fs";
import path from "path";

export interface QuestionItem {
  id: number;
  csvId: number;
  category: string;
  question: string;
  option1: string;
  option2: string;
}

const CATEGORIES_ORDER = ["음식", "여행", "생활방식", "로맨스", "여가활동"];

function loadQuestionsFromCsv(): QuestionItem[] {
  const csvPath = path.join(process.cwd(), "questions.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rawList: Omit<QuestionItem, "id">[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    if (parts.length >= 5) {
      const csvId = Number(parts[0]);
      if (!Number.isNaN(csvId) && csvId > 0) {
        rawList.push({
          csvId,
          category: parts[1],
          question: parts[2],
          option1: parts[3],
          option2: parts[4],
        });
      }
    }
  }

  const byCategory = new Map<string, Omit<QuestionItem, "id">[]>();
  for (const cat of CATEGORIES_ORDER) {
    byCategory.set(
      cat,
      rawList.filter((q) => q.category === cat)
    );
  }

  const interleaved: QuestionItem[] = [];
  const maxPerCat = Math.max(
    ...Array.from(byCategory.values()).map((arr) => arr.length),
    0
  );

  for (let round = 0; round < maxPerCat; round++) {
    for (const cat of CATEGORIES_ORDER) {
      const arr = byCategory.get(cat) || [];
      if (round < arr.length) {
        interleaved.push({
          ...arr[round],
          id: interleaved.length + 1,
        });
      }
    }
  }

  for (const item of rawList) {
    if (!CATEGORIES_ORDER.includes(item.category)) {
      interleaved.push({
        ...item,
        id: interleaved.length + 1,
      });
    }
  }

  return interleaved;
}

// GET /api/game?code=A387 — 방 정보 + CSV 질문 목록 + 현재 방의 답변 목록 조회
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") || "").trim().toUpperCase();
    const questions = loadQuestionsFromCsv();

    if (!code) {
      return NextResponse.json({ questions });
    }

    const pool = getDbPool();
    const [roomRes, answersRes] = await Promise.all([
      pool.query(
        `SELECT id, room_code, status, current_question, host_user_id, guest_user_id, created_at
         FROM public.rooms
         WHERE UPPER(room_code) = $1
         LIMIT 1`,
        [code]
      ),
      pool.query(
        `SELECT id, room_code, player, question_id, answer, user_id, created_at
         FROM public.answers
         WHERE UPPER(room_code) = $1
         ORDER BY question_id ASC, created_at ASC`,
        [code]
      ),
    ]);

    if (roomRes.rowCount === 0) {
      return NextResponse.json(
        { error: "존재하지 않는 방입니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      room: roomRes.rows[0],
      answers: answersRes.rows,
      questions,
    });
  } catch (err) {
    console.error("GET /api/game error:", err);
    return NextResponse.json(
      { error: "게임 정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST /api/game — 답변 저장 (action: "answer") 또는 다음 질문/결과 이동 (action: "next")
export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequestUser(req);
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const action = body.action || "answer";
    const roomCode = (body.roomCode || "").trim().toUpperCase();
    const pool = getDbPool();

    if (!roomCode) {
      return NextResponse.json(
        { error: "방 코드가 필요합니다." },
        { status: 400 }
      );
    }

    if (action === "answer") {
      const player = body.player === "player2" ? "player2" : "player1";
      const questionId = Number(body.questionId);
      const answer = String(body.answer || "").trim();

      if (!questionId || !answer) {
        return NextResponse.json(
          { error: "질문 번호와 답변이 필요합니다." },
          { status: 400 }
        );
      }

      const upsertRes = await pool.query(
        `INSERT INTO public.answers (room_code, player, question_id, answer, user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_code, player, question_id)
         DO UPDATE SET answer = EXCLUDED.answer, user_id = EXCLUDED.user_id, created_at = now()
         RETURNING id, room_code, player, question_id, answer, user_id, created_at`,
        [roomCode, player, questionId, answer, user.id]
      );

      return NextResponse.json({ answer: upsertRes.rows[0] });
    }

    if (action === "next") {
      const fromQuestion = Number(body.fromQuestion);
      const nextQuestion = Number(body.nextQuestion);

      if (!Number.isNaN(fromQuestion) && !Number.isNaN(nextQuestion)) {
        const updated = await pool.query(
          `UPDATE public.rooms
           SET current_question = $2
           WHERE UPPER(room_code) = $1 AND current_question = $3
           RETURNING id, room_code, status, current_question, host_user_id, guest_user_id, created_at`,
          [roomCode, nextQuestion, fromQuestion]
        );

        if (updated.rowCount && updated.rowCount > 0) {
          return NextResponse.json({ room: updated.rows[0] });
        }
      } else if (!Number.isNaN(nextQuestion)) {
        const updated = await pool.query(
          `UPDATE public.rooms
           SET current_question = $2
           WHERE UPPER(room_code) = $1
           RETURNING id, room_code, status, current_question, host_user_id, guest_user_id, created_at`,
          [roomCode, nextQuestion]
        );
        if (updated.rowCount && updated.rowCount > 0) {
          return NextResponse.json({ room: updated.rows[0] });
        }
      }

      const currentRes = await pool.query(
        `SELECT id, room_code, status, current_question, host_user_id, guest_user_id, created_at
         FROM public.rooms
         WHERE UPPER(room_code) = $1
         LIMIT 1`,
        [roomCode]
      );
      return NextResponse.json({ room: currentRes.rows[0] || null });
    }

    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  } catch (err) {
    console.error("POST /api/game error:", err);
    return NextResponse.json(
      { error: "게임 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
