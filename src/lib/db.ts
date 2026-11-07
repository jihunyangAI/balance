import { Pool } from "pg";

export interface RoomRow {
  id: string;
  room_code: string;
  status: string;
  current_question: number;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  room_code: string;
  player: "player1" | "player2";
  question_id: number;
  answer: string;
  created_at: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __balancePgPool: Pool | undefined;
}

export function getDbPool(): Pool {
  if (!global.__balancePgPool) {
    const connectionString =
      process.env.DATABASE_URL || process.env.DIRECT_URL || "";
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL 또는 DIRECT_URL 환경변수가 설정되어 있지 않습니다."
      );
    }
    global.__balancePgPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return global.__balancePgPool;
}

// 생성 후 10분 동안 아무도 접속하지 않은 빈 방(대기 상태)을 rooms 테이블에서 자동 삭제
export async function cleanupExpiredWaitingRooms(): Promise<void> {
  try {
    const pool = getDbPool();
    await pool.query(
      `DELETE FROM public.rooms
       WHERE status IN ('대기', 'waiting')
         AND created_at < now() - interval '10 minutes'`
    );
  } catch (err) {
    console.error("cleanupExpiredWaitingRooms error:", err);
  }
}

// 영문 대문자 + 숫자 조합 4자리 랜덤 코드 생성 (예: A387)
export function generateRoomCode(): string {
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const pool = allLetters + digits;

  while (true) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += pool.charAt(Math.floor(Math.random() * pool.length));
    }
    const hasLetter = /[A-Z]/.test(code);
    const hasDigit = /[0-9]/.test(code);
    if (hasLetter && hasDigit) {
      return code;
    }
  }
}
