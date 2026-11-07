"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseClient, getAuthHeaders } from "@/lib/supabase";

type ScreenMode = "start" | "waiting" | "join" | "starting";

interface RoomData {
  id: string;
  room_code: string;
  status: string;
  current_question: number;
  created_at: string;
}

// 영문대문자 + 숫자 조합 4자리 코드 생성 (예: A387)
function createRandom4CharCode(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const pool = letters + digits;

  while (true) {
    let result = "";
    for (let i = 0; i < 4; i++) {
      result += pool.charAt(Math.floor(Math.random() * pool.length));
    }
    if (/[A-Z]/.test(result) && /[0-9]/.test(result)) {
      return result;
    }
  }
}

function BalanceGameStartContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Supabase Auth 상태
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // 게임 방 상태
  const [mode, setMode] = useState<ScreenMode>("start");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [activePlayer, setActivePlayer] = useState<"player1" | "player2">(
    "player1"
  );
  const [inputCode, setInputCode] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startCountdown, setStartCountdown] = useState<number>(3);

  // Supabase Auth 세션 확인 및 상태 변경 구독
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthChecking(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      setAuthChecking(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // 결과 화면에서 "다시 도전하기"(새 방생성)로 넘어온 경우 자동으로 대기 화면 표시
  useEffect(() => {
    if (!authUser) return;
    const waitingCode = searchParams.get("waitingCode")?.trim().toUpperCase();
    if (!waitingCode || waitingCode.length !== 4) return;

    fetch(`/api/rooms?code=${encodeURIComponent(waitingCode)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.room) {
          setRoom(data.room);
          setActivePlayer("player1");
          setMode("waiting");
        }
      })
      .catch(() => {});
  }, [searchParams, authUser]);

  // Supabase Auth 이메일/비밀번호 로그인 및 회원가입 처리
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Supabase 클라이언트를 초기화할 수 없습니다.");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthError("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }

    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setAuthError(error.message);
          return;
        }
        // 자동 이메일 인증 트리거가 적용되어 있어 즉시 로그인 세션 획득 가능
        if (!data.session) {
          const signInRes = await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });
          if (signInRes.error) {
            setAuthError(signInRes.error.message);
            return;
          }
          setAuthUser(signInRes.data.user);
        } else {
          setAuthUser(data.user);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setAuthError(
            error.message.includes("Invalid login credentials")
              ? "이메일 또는 비밀번호가 올바르지 않습니다."
              : error.message
          );
          return;
        }
        setAuthUser(data.user);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // 원클릭 테스트 계정 로그인
  const handleQuickTestLogin = async (testEmail: string) => {
    setAuthError(null);
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: "password1234",
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setAuthUser(data.user);
    } finally {
      setAuthLoading(false);
    }
  };

  // 로그아웃
  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setMode("start");
    setRoom(null);
  };

  // 1. "방 만들기" 클릭 시 (플레이어1)
  const handleCreateRoom = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const generatedCode = createRandom4CharCode();
      const headers = await getAuthHeaders();
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "create",
          roomCode: generatedCode,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.room) {
        setErrorMsg(data.error || "방 생성에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      const createdRoom: RoomData = data.room;

      if (typeof window !== "undefined") {
        localStorage.setItem("player", "player1");
        localStorage.setItem("roomCode", createdRoom.room_code);
        localStorage.setItem("room_code", createdRoom.room_code);
        sessionStorage.setItem("player", "player1");
        sessionStorage.setItem("roomCode", createdRoom.room_code);
      }

      setRoom(createdRoom);
      setActivePlayer("player1");
      setMode("waiting");
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // "방 참가하기" 클릭 시 4자리 코드 입력창 표시
  const handleOpenJoin = () => {
    setErrorMsg(null);
    setInputCode("");
    setMode("join");
  };

  // 2. 플레이어2 "입장하기" 클릭 시
  const handleJoinRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const trimmedCode = inputCode.trim().toUpperCase();
    if (!trimmedCode || trimmedCode.length !== 4) {
      setErrorMsg("존재하지 않는 방입니다");
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "join",
          roomCode: trimmedCode,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.room) {
        setErrorMsg(data.error || "존재하지 않는 방입니다");
        return;
      }

      const joinedRoom: RoomData = data.room;

      if (typeof window !== "undefined") {
        localStorage.setItem("player", "player2");
        localStorage.setItem("roomCode", joinedRoom.room_code);
        localStorage.setItem("room_code", joinedRoom.room_code);
        sessionStorage.setItem("player", "player2");
        sessionStorage.setItem("roomCode", joinedRoom.room_code);
      }

      setRoom(joinedRoom);
      setActivePlayer("player2");
      setStartCountdown(3);
      setMode("starting");
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 3. 플레이어1 대기 중: 상대방 입장 감지 + 10분 미접속 자동 삭제
  useEffect(() => {
    if (mode !== "waiting" || !room?.room_code) return;

    const currentCode = room.room_code;
    let triggered = false;

    const triggerStartingCountdown = () => {
      if (triggered) return;
      triggered = true;
      setStartCountdown(3);
      setMode("starting");
    };

    const supabase = getSupabaseClient();
    const channel = supabase
      ?.channel(`room-watch-${currentCode}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `room_code=eq.${currentCode}`,
        },
        (payload) => {
          const updated = payload.new as RoomData;
          if (
            updated &&
            (updated.status === "진행중" || updated.status === "playing")
          ) {
            triggerStartingCountdown();
          }
        }
      )
      .subscribe();

    const intervalId = setInterval(async () => {
      if (triggered) return;
      try {
        const res = await fetch(
          `/api/rooms?code=${encodeURIComponent(currentCode)}`,
          { cache: "no-store" }
        );
        if (res.status === 404) {
          setMode("start");
          setRoom(null);
          setErrorMsg(
            "생성 후 10분 동안 참가자가 없어 방이 자동 삭제되었습니다."
          );
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (
          data?.room?.status === "진행중" ||
          data?.room?.status === "playing"
        ) {
          triggerStartingCountdown();
        }
      } catch {
        // ignore transient errors
      }
    }, 1500);

    const createdTime = room.created_at
      ? new Date(room.created_at).getTime()
      : Date.now();
    const elapsedMs = Math.max(0, Date.now() - createdTime);
    const remainingMs = Math.max(1000, 10 * 60 * 1000 - elapsedMs);

    const expireTimer = setTimeout(async () => {
      if (triggered) return;
      try {
        await fetch(`/api/rooms?code=${encodeURIComponent(currentCode)}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
      setMode("start");
      setRoom(null);
      setErrorMsg("생성 후 10분 동안 참가자가 없어 방이 자동 삭제되었습니다.");
    }, remainingMs);

    return () => {
      clearInterval(intervalId);
      clearTimeout(expireTimer);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [mode, room?.room_code, room?.created_at]);

  // 4. 상대방 입장 시 3초간 카운트다운 후 플레이어 모두 게임 시작
  useEffect(() => {
    if (mode !== "starting" || !room?.room_code) return;

    const currentCode = room.room_code;
    setStartCountdown(3);

    const tick = setInterval(() => {
      setStartCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    const moveTimer = setTimeout(() => {
      router.push(
        `/game?code=${encodeURIComponent(currentCode)}&player=${activePlayer}`
      );
    }, 3000);

    return () => {
      clearInterval(tick);
      clearTimeout(moveTimer);
    };
  }, [mode, room?.room_code, activePlayer, router]);

  const handleCopyCode = async () => {
    if (!room?.room_code) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API fallback
    }
  };

  const handleResetToStart = async () => {
    if (mode === "waiting" && room?.room_code) {
      try {
        await fetch(`/api/rooms?code=${encodeURIComponent(room.room_code)}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
    }
    setMode("start");
    setRoom(null);
    setInputCode("");
    setErrorMsg(null);
    router.replace("/");
  };

  return (
    <main className="min-h-screen w-full bg-[#FFF0F5] flex items-center justify-center px-4 py-10">
      {/* 카드: 흰색 배경, 최대너비 400px */}
      <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-lg border border-pink-100 p-8 text-center">
        {/* 로그인된 경우 상단 사용자 정보 & 로그아웃 표시 */}
        {authUser && (
          <div className="flex items-center justify-between text-xs bg-pink-50/70 border border-pink-100 rounded-xl px-3 py-2 mb-5">
            <span className="font-semibold text-gray-700 truncate max-w-[220px]">
              👤 {authUser.email}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-pink-600 hover:text-pink-800 font-bold shrink-0 cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        )}

        {/* 상단 타이틀 영역 */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-pink-100 text-3xl mb-3 shadow-xs">
            ⚖️
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            취향 밸런스 게임
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            서로 얼마나 잘 알고 있나요?
          </p>
        </div>

        {authChecking ? (
          <div className="py-8 flex flex-col items-center space-y-3">
            <div className="w-7 h-7 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500 font-medium">
              인증 상태를 확인하는 중...
            </p>
          </div>
        ) : !authUser ? (
          /* ================= Supabase Auth 로그인 / 회원가입 화면 ================= */
          <div className="space-y-4 mt-4 text-left">
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg transition cursor-pointer ${
                  authMode === "login"
                    ? "bg-white text-blue-600 shadow-2xs"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                로그인
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg transition cursor-pointer ${
                  authMode === "signup"
                    ? "bg-white text-blue-600 shadow-2xs"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                회원가입
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">
                  이메일
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full py-3 px-3.5 rounded-xl border-2 border-gray-200 focus:border-blue-600 focus:outline-none text-sm font-medium text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">
                  비밀번호 (6자 이상)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full py-3 px-3.5 rounded-xl border-2 border-gray-200 focus:border-blue-600 focus:outline-none text-sm font-medium text-gray-900"
                />
              </div>

              {authError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold text-center"
                >
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] hover:shadow-md text-white font-bold text-sm transition-all duration-200 cursor-pointer disabled:opacity-60"
              >
                {authLoading
                  ? "처리 중..."
                  : authMode === "login"
                  ? "이메일로 로그인"
                  : "회원가입 및 자동 로그인"}
              </button>
            </form>

            {/* 빠른 2인 테스트용 원클릭 로그인 버튼 */}
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <p className="text-[11px] font-bold text-gray-400 text-center">
                ⚡ 빠른 테스트용 원클릭 로그인
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => handleQuickTestLogin("player1@balance.game")}
                  className="py-2 px-3 rounded-xl bg-pink-50 hover:bg-pink-100 border border-pink-200 text-pink-700 text-xs font-bold transition cursor-pointer"
                >
                  Player 1 계정
                </button>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => handleQuickTestLogin("player2@balance.game")}
                  className="py-2 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold transition cursor-pointer"
                >
                  Player 2 계정
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 1. 시작 화면 */}
            {mode === "start" && (
              <div className="space-y-3.5 mt-6">
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  disabled={loading}
                  className="w-full py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] hover:shadow-md active:bg-blue-800 text-white font-bold text-base shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-60"
                >
                  {loading ? "방 만드는 중..." : "방 만들기"}
                </button>

                <button
                  type="button"
                  onClick={handleOpenJoin}
                  disabled={loading}
                  className="w-full py-3.5 px-5 rounded-xl bg-white hover:bg-gray-50 hover:scale-[1.02] hover:shadow-md active:bg-gray-100 text-gray-800 font-bold text-base border-2 border-gray-300 transition-all duration-200 cursor-pointer disabled:opacity-60"
                >
                  방 참가하기
                </button>

                {errorMsg && (
                  <div
                    role="alert"
                    className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-semibold"
                  >
                    {errorMsg}
                  </div>
                )}
              </div>
            )}

            {/* 2. "방 만들기" 클릭 시: 대기 화면 */}
            {mode === "waiting" && room && (
              <div className="mt-6 space-y-6">
                <div className="bg-pink-50/80 border border-pink-200 rounded-2xl py-6 px-4">
                  <p className="text-xs font-semibold text-pink-600 uppercase tracking-wider mb-2">
                    방 코드
                  </p>
                  <div
                    onClick={handleCopyCode}
                    title="클릭하여 복사"
                    className="text-5xl font-black tracking-[0.2em] text-blue-600 select-all cursor-pointer py-1"
                  >
                    {room.room_code}
                  </div>
                  <p className="text-sm text-gray-700 font-semibold mt-3">
                    이 코드를 상대방에게 알려주세요
                  </p>
                  {copied && (
                    <p className="text-xs text-blue-600 font-medium mt-1">
                      클립보드에 복사되었습니다!
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-center justify-center space-y-3 py-2">
                  <div className="w-7 h-7 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-gray-700">
                    상대방이 참가할때까지 기다리는 중...
                  </p>
                  <p className="text-xs text-gray-400">
                    (10분 동안 아무도 접속하지 않으면 방이 자동 삭제됩니다)
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleResetToStart}
                  className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-600 font-semibold text-sm border border-gray-200 transition cursor-pointer"
                >
                  처음으로 돌아가기
                </button>
              </div>
            )}

            {/* 3. "방 참가하기" 클릭 시: 4자리 코드 입력창 (자동 대문자 변환) */}
            {mode === "join" && (
              <form onSubmit={handleJoinRoom} className="mt-6 space-y-4">
                <div className="text-left">
                  <label
                    htmlFor="room-code-input"
                    className="block text-xs font-bold text-gray-600 mb-1.5 ml-1"
                  >
                    방 코드 (4자리 · 소문자 입력 시 자동 대문자 변환)
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    maxLength={4}
                    value={inputCode}
                    onChange={(e) => {
                      const upperVal = e.target.value
                        .replace(/[^a-zA-Z0-9]/g, "")
                        .toUpperCase();
                      setInputCode(upperVal);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    placeholder="예: A387"
                    autoCapitalize="characters"
                    autoFocus
                    className="w-full py-3.5 px-4 text-center text-2xl font-extrabold tracking-[0.25em] uppercase rounded-xl border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-gray-900 placeholder:text-gray-300 placeholder:tracking-normal placeholder:font-medium placeholder:text-base"
                  />
                </div>

                {errorMsg && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-bold"
                  >
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] hover:shadow-md active:bg-blue-800 text-white font-bold text-base shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-60"
                >
                  {loading ? "확인 중..." : "입장하기"}
                </button>

                <button
                  type="button"
                  onClick={handleResetToStart}
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-600 font-semibold text-sm border border-gray-200 transition cursor-pointer"
                >
                  취소
                </button>
              </form>
            )}

            {/* 4. 상대방 입장 완료 시: 시작 버튼 없이 3초간 카운트다운 후 플레이어 모두 게임 시작 */}
            {mode === "starting" && room && (
              <div className="mt-6 py-6 space-y-5 animate-slide-in-right">
                <div className="bg-blue-50 border border-blue-200 rounded-2xl py-7 px-4 space-y-3">
                  <p className="text-sm font-extrabold text-blue-700">
                    🎉 상대방이 입장했습니다!
                  </p>
                  <div className="text-6xl font-black text-blue-600 animate-bounce py-2">
                    {startCountdown}
                  </div>
                  <p className="text-sm font-bold text-gray-700">
                    {startCountdown}초 후 게임이 자동으로 시작됩니다...
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function BalanceGameStartPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full bg-[#FFF0F5] flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-lg border border-pink-100 p-8 text-center">
            <p className="text-sm text-gray-600 font-medium">로딩 중...</p>
          </div>
        </main>
      }
    >
      <BalanceGameStartContent />
    </Suspense>
  );
}
