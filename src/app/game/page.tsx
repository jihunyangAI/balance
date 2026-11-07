"use client";

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient, getAuthHeaders } from "@/lib/supabase";

const MAX_QUESTIONS = 5; // 테스트용 총 5문항 진행 후 최종결과 화면 표시
const CATEGORIES = ["음식", "여행", "생활방식", "로맨스", "여가활동"] as const;

interface RoomData {
  id: string;
  room_code: string;
  status: string;
  current_question: number;
  created_at: string;
}

interface AnswerData {
  id: string;
  room_code: string;
  player: "player1" | "player2";
  question_id: number;
  answer: string;
  created_at: string;
}

interface QuestionItem {
  id: number;
  csvId?: number;
  category: string;
  question: string;
  option1: string;
  option2: string;
}

function getMatchComment(rate: number): string {
  if (rate >= 90) return "환상의 짝꿍";
  if (rate >= 70) return "꽤 잘맞는 사이";
  if (rate >= 50) return "다름이 매력적인 사이";
  return "서로 알아가고 있는 사이";
}

function GameScreenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [roomCode, setRoomCode] = useState<string>("");
  const [player, setPlayer] = useState<"player1" | "player2">("player1");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [answers, setAnswers] = useState<AnswerData[]>([]);
  const [optimisticAnswer, setOptimisticAnswer] = useState<{
    questionId: number;
    answer: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<number>(3);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [creatingNewRoom, setCreatingNewRoom] = useState(false);

  // 1. 질문 전환 슬라이드 애니메이션 상태
  const [displayedQuestionNum, setDisplayedQuestionNum] = useState<number>(1);
  const [slideState, setSlideState] = useState<"idle" | "out" | "in">("in");

  // 5. 상대방이 답변한 순간 진동(shake) 애니메이션 상태
  const [isShaking, setIsShaking] = useState(false);
  const prevPartnerAnsweredQRef = useRef<number | null>(null);
  const advancingRef = useRef<number | null>(null);

  const fetchGameState = useCallback(async (code: string) => {
    if (!code) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/game?code=${encodeURIComponent(code)}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.room) setRoom(data.room);
      if (Array.isArray(data.answers)) setAnswers(data.answers);
      if (Array.isArray(data.questions)) {
        setQuestions((prev) =>
          prev.length === data.questions.length && prev.length > 0
            ? prev
            : data.questions
        );
      }
    } catch {
      // ignore transient fetch errors
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase?.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.replace("/");
      }
    });

    const queryPlayer = searchParams.get("player");
    const sessionPlayer = sessionStorage.getItem("player");
    const localPlayer = localStorage.getItem("player");
    const resolvedPlayer =
      queryPlayer === "player2" ||
      (!queryPlayer && (sessionPlayer || localPlayer) === "player2")
        ? "player2"
        : "player1";

    const storedCode = (
      searchParams.get("code") ||
      sessionStorage.getItem("roomCode") ||
      localStorage.getItem("roomCode") ||
      localStorage.getItem("room_code") ||
      ""
    )
      .trim()
      .toUpperCase();

    setPlayer(resolvedPlayer);
    setRoomCode(storedCode);

    if (!storedCode) {
      setLoading(false);
      return;
    }

    fetchGameState(storedCode).finally(() => setLoading(false));

    // Supabase Realtime으로 answers 테이블 및 rooms 테이블 구독 (RLS 인증 세션 포함)
    const channel = supabase
      ?.channel(`game-room-${storedCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `room_code=eq.${storedCode}`,
        },
        (payload) => {
          const incoming = payload.new as AnswerData;
          if (incoming && incoming.id) {
            setAnswers((prev) => {
              const filtered = prev.filter(
                (a) =>
                  !(
                    a.player === incoming.player &&
                    a.question_id === incoming.question_id
                  )
              );
              return [...filtered, incoming];
            });
          } else {
            fetchGameState(storedCode);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `room_code=eq.${storedCode}`,
        },
        (payload) => {
          if (payload.new) {
            setRoom(payload.new as RoomData);
          }
        }
      )
      .subscribe();

    const intervalId = setInterval(() => {
      fetchGameState(storedCode);
    }, 2000);

    return () => {
      clearInterval(intervalId);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [searchParams, fetchGameState, router]);

  const targetQuestionNum = room?.current_question ?? 1;

  // 질문 번호 변경 시: 왼쪽으로 사라진 뒤(slide-out-left) 다음 질문이 오른쪽에서 등장(slide-in-right)
  useEffect(() => {
    if (targetQuestionNum === displayedQuestionNum) return;

    setSlideState("out");
    const outTimer = setTimeout(() => {
      setDisplayedQuestionNum(targetQuestionNum);
      setSlideState("in");
    }, 260);

    return () => clearTimeout(outTimer);
  }, [targetQuestionNum, displayedQuestionNum]);

  const currentQuestionNum = displayedQuestionNum;
  const isFinished = currentQuestionNum > MAX_QUESTIONS;

  // 6. 게임 중 방을 나가면 경고: "게임이 진행중입니다. 정말 나가시겠습니까?" 확인창
  useEffect(() => {
    if (isFinished || loading) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "게임이 진행중입니다. 정말 나가시겠습니까?";
      return "게임이 진행중입니다. 정말 나가시겠습니까?";
    };

    window.history.pushState({ inGame: true }, "", window.location.href);
    const handlePopState = () => {
      const confirmed = window.confirm(
        "게임이 진행중입니다. 정말 나가시겠습니까?"
      );
      if (confirmed) {
        router.push("/");
      } else {
        window.history.pushState({ inGame: true }, "", window.location.href);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isFinished, loading, router]);

  const handleLeaveGame = () => {
    if (!isFinished) {
      const confirmed = window.confirm(
        "게임이 진행중입니다. 정말 나가시겠습니까?"
      );
      if (!confirmed) return;
    }
    router.push("/");
  };

  const currentQuestion = !isFinished
    ? questions.find((q) => q.id === currentQuestionNum) ||
      questions[currentQuestionNum - 1] ||
      questions[0] ||
      null
    : null;

  const currentAnswers = answers.filter(
    (a) => a.question_id === currentQuestionNum
  );
  const dbMyAnswer = currentAnswers.find((a) => a.player === player)?.answer;
  const myAnswer =
    dbMyAnswer ||
    (optimisticAnswer?.questionId === currentQuestionNum
      ? optimisticAnswer.answer
      : undefined);

  const partnerRole = player === "player1" ? "player2" : "player1";
  const partnerAnswer = currentAnswers.find(
    (a) => a.player === partnerRole
  )?.answer;

  // 5. 상대방이 답변한 순간 효과: 진동 애니메이션(CSS shake effect) + "상대방이 선택했어요!" 텍스트
  useEffect(() => {
    if (
      !isFinished &&
      partnerAnswer &&
      prevPartnerAnsweredQRef.current !== currentQuestionNum
    ) {
      prevPartnerAnsweredQRef.current = currentQuestionNum;
      setIsShaking(true);
      const timer = setTimeout(() => {
        setIsShaking(false);
      }, 650);
      return () => clearTimeout(timer);
    }
  }, [partnerAnswer, currentQuestionNum, isFinished]);

  const bothAnswered = Boolean(!isFinished && myAnswer && partnerAnswer);
  const isMatched = bothAnswered && myAnswer === partnerAnswer;

  // 선택지 버튼 클릭 시: 답변 테이블에 저장 + 내 버튼 선택됨 상태 표시
  const handleSelectOption = async (selectedOption: string) => {
    if (!roomCode || !currentQuestion || submitting || bothAnswered) return;

    setOptimisticAnswer({
      questionId: currentQuestion.id,
      answer: selectedOption,
    });
    setSubmitting(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/game", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "answer",
          roomCode,
          player,
          questionId: currentQuestion.id,
          answer: selectedOption,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.answer) {
          setAnswers((prev) => {
            const filtered = prev.filter(
              (a) =>
                !(
                  a.player === data.answer.player &&
                  a.question_id === data.answer.question_id
                )
            );
            return [...filtered, data.answer];
          });
        }
        await fetchGameState(roomCode);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 결과 공개 후 3초 뒤 다음 질문(5번 질문 완료 시 최종결과 화면)으로 자동 이동
  useEffect(() => {
    if (!bothAnswered || !roomCode || isFinished) {
      setCountdown(3);
      return;
    }

    const targetFromQuestion = currentQuestionNum;
    setCountdown(3);

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    const timer = setTimeout(async () => {
      if (advancingRef.current === targetFromQuestion) return;
      advancingRef.current = targetFromQuestion;

      const nextQuestionNum = targetFromQuestion + 1;

      setOptimisticAnswer(null);
      setRoom((prev) =>
        prev ? { ...prev, current_question: nextQuestionNum } : prev
      );

      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/game", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "next",
            roomCode,
            fromQuestion: targetFromQuestion,
            nextQuestion: nextQuestionNum,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.room) {
            setRoom(data.room);
          }
        }
        await fetchGameState(roomCode);
      } catch {
        // ignore transient error
      }
    }, 3000);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(timer);
    };
  }, [bothAnswered, roomCode, currentQuestionNum, isFinished, fetchGameState]);

  // ===== answers 테이블 기반 최종 결과 집계 =====
  const evaluatedPairs = React.useMemo(() => {
    const questionIds = Array.from(
      new Set(
        answers
          .map((a) => a.question_id)
          .filter((id) => id >= 1 && id <= MAX_QUESTIONS)
      )
    ).sort((a, b) => a - b);

    return questionIds
      .map((qId) => {
        const p1 = answers.find(
          (a) => a.question_id === qId && a.player === "player1"
        );
        const p2 = answers.find(
          (a) => a.question_id === qId && a.player === "player2"
        );
        if (!p1 || !p2) return null;

        const myAns = player === "player1" ? p1.answer : p2.answer;
        const partnerAns = player === "player1" ? p2.answer : p1.answer;

        const matchedQuestion =
          questions.find(
            (q) =>
              q.option1 === p1.answer ||
              q.option2 === p1.answer ||
              q.option1 === p2.answer ||
              q.option2 === p2.answer
          ) ||
          questions.find((q) => q.id === qId) || {
            id: qId,
            category: CATEGORIES[(qId - 1) % CATEGORIES.length],
            question: `질문 ${qId}`,
            option1: p1.answer,
            option2: p2.answer,
          };

        const matched = p1.answer === p2.answer;
        const dramaScore =
          p1.answer.length + p2.answer.length + matchedQuestion.question.length;

        return {
          questionId: qId,
          category: matchedQuestion.category,
          questionText: matchedQuestion.question,
          myAnswer: myAns,
          partnerAnswer: partnerAns,
          matched,
          dramaScore,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [answers, questions, player]);

  const totalEvaluated = evaluatedPairs.length;
  const totalMatched = evaluatedPairs.filter((p) => p.matched).length;
  const overallMatchRate =
    totalEvaluated > 0 ? Math.round((totalMatched / totalEvaluated) * 100) : 0;
  const matchComment = getMatchComment(overallMatchRate);

  const categoryStats = React.useMemo(() => {
    return CATEGORIES.map((cat) => {
      const inCat = evaluatedPairs.filter((p) => p.category === cat);
      const matchedInCat = inCat.filter((p) => p.matched).length;
      const rate =
        inCat.length > 0 ? Math.round((matchedInCat / inCat.length) * 100) : 0;
      return {
        category: cat,
        total: inCat.length,
        matched: matchedInCat,
        rate,
      };
    });
  }, [evaluatedPairs]);

  const top3DifferentQuestions = React.useMemo(() => {
    return evaluatedPairs
      .filter((p) => !p.matched)
      .sort((a, b) => b.dramaScore - a.dramaScore)
      .slice(0, 3);
  }, [evaluatedPairs]);

  // "다시 도전하기" 버튼 (새 방 생성)
  const handleRetryNewRoom = async () => {
    if (creatingNewRoom) return;
    setCreatingNewRoom(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json();
      if (res.ok && data.room) {
        const newCode = data.room.room_code;
        localStorage.setItem("player", "player1");
        localStorage.setItem("roomCode", newCode);
        localStorage.setItem("room_code", newCode);
        sessionStorage.setItem("player", "player1");
        sessionStorage.setItem("roomCode", newCode);
        router.push(`/?waitingCode=${encodeURIComponent(newCode)}`);
        return;
      }
      router.push("/");
    } catch {
      router.push("/");
    } finally {
      setCreatingNewRoom(false);
    }
  };

  // "결과 공유하기" 버튼
  const handleShareResult = async () => {
    const categorySummary = categoryStats
      .map((c) => `${c.category} ${c.rate}%`)
      .join(" · ");
    const shareText = [
      `[취향 밸런스 게임 결과]`,
      `전체 일치율: ${overallMatchRate}% 일치 ("${matchComment}")`,
      `카테고리별: ${categorySummary}`,
      `링크: ${typeof window !== "undefined" ? window.location.href : ""}`,
    ].join("\n");

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "취향 밸런스 게임 결과",
          text: shareText,
          url: window.location.href,
        });
        return;
      }
    } catch {
      // fallback to clipboard
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setShareMessage("결과가 클립보드에 복사되었습니다!");
      setTimeout(() => setShareMessage(null), 2500);
    } catch {
      setShareMessage("공유 텍스트 복사에 실패했습니다.");
      setTimeout(() => setShareMessage(null), 2500);
    }
  };

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((currentQuestionNum / MAX_QUESTIONS) * 100))
  );

  const slideAnimationClass =
    slideState === "out"
      ? "animate-slide-out-left"
      : slideState === "in"
      ? "animate-slide-in-right"
      : "";

  return (
    <main className="min-h-screen w-full bg-[#FFF0F5] flex items-center justify-center px-4 py-8 overflow-x-hidden">
      {/* 카드: 흰색, 최대너비 400px + 상대방 답변 시 진동 애니메이션 */}
      <div
        className={`w-full max-w-[400px] bg-white rounded-3xl shadow-lg border border-pink-100 p-7 text-center overflow-hidden ${
          isShaking ? "animate-shake" : ""
        }`}
      >
        {loading ? (
          <div className="py-12 flex flex-col items-center space-y-3">
            <div className="w-7 h-7 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-600 font-medium">
              데이터를 불러오는 중...
            </p>
          </div>
        ) : isFinished ? (
          /* ================= 최종 결과 화면 (질문 5개 완료 시) ================= */
          <div className="flex flex-col space-y-6 text-left animate-slide-in-right">
            {/* 1. 상단: 전체 일치율 + 일치율별 멘트 */}
            <div className="text-center bg-pink-50/80 border border-pink-200 rounded-2xl p-6">
              <p className="text-xs font-bold text-pink-600 uppercase tracking-wider mb-1">
                우리 두 사람의 취향 일치율
              </p>
              <div className="text-4xl font-black text-blue-600 tracking-tight my-1">
                {overallMatchRate}% 일치
              </div>
              <p className="inline-block mt-2 px-4 py-1 rounded-full bg-white border border-pink-200 text-base font-extrabold text-gray-900 shadow-2xs">
                &ldquo;{matchComment}&rdquo;
              </p>
              <p className="text-xs text-gray-500 mt-2 font-medium">
                총 {totalEvaluated}문제 중 {totalMatched}문제 일치
              </p>
            </div>

            {/* 2. 중간: 카테고리별 일치율 막대그래프 */}
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-gray-800">
                📊 카테고리별 일치율
              </h3>
              <div className="space-y-2.5 bg-gray-50/80 border border-gray-100 rounded-2xl p-4">
                {categoryStats.map((stat) => (
                  <div key={stat.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-gray-700">{stat.category}</span>
                      <span className="text-blue-600">{stat.rate}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${stat.rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. 가장 다른 답변이 나온 질문 TOP 3 표시 */}
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-gray-800">
                ⚡ 가장 다른 답변이 나온 질문 TOP 3
              </h3>
              {top3DifferentQuestions.length === 0 ? (
                <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-center text-xs font-bold text-blue-700">
                  모든 질문에서 두 사람의 선택이 완벽하게 일치했어요! 🎉
                </div>
              ) : (
                <div className="space-y-2.5">
                  {top3DifferentQuestions.map((item, idx) => (
                    <div
                      key={item.questionId}
                      className="p-3.5 rounded-2xl bg-white border border-pink-200 shadow-2xs space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-pink-100 text-pink-700 text-[11px] font-extrabold">
                          TOP {idx + 1} · {item.category}
                        </span>
                      </div>
                      <p className="text-xs font-extrabold text-gray-900 break-keep leading-snug">
                        Q. {item.questionText}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-2 rounded-xl bg-blue-50/70 border border-blue-100">
                          <p className="text-[10px] font-bold text-blue-600">
                            내 선택
                          </p>
                          <p className="text-xs font-bold text-gray-800 break-keep mt-0.5">
                            {item.myAnswer}
                          </p>
                        </div>
                        <div className="p-2 rounded-xl bg-pink-50/70 border border-pink-100">
                          <p className="text-[10px] font-bold text-pink-600">
                            상대방의 선택
                          </p>
                          <p className="text-xs font-bold text-gray-800 break-keep mt-0.5">
                            {item.partnerAnswer}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {shareMessage && (
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold text-center">
                {shareMessage}
              </div>
            )}

            {/* 4. 하단 버튼: "다시 도전하기" (새 방생성) + "결과 공유하기" */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleRetryNewRoom}
                disabled={creatingNewRoom}
                className="w-full py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] hover:shadow-md active:bg-blue-800 text-white font-bold text-sm shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-60"
              >
                {creatingNewRoom ? "새 방 만드는 중..." : "다시 도전하기"}
              </button>

              <button
                type="button"
                onClick={handleShareResult}
                className="w-full py-3.5 px-5 rounded-xl bg-white hover:bg-gray-50 hover:scale-[1.02] hover:shadow-md active:bg-gray-100 text-gray-800 font-bold text-sm border-2 border-gray-300 transition-all duration-200 cursor-pointer"
              >
                결과 공유하기
              </button>
            </div>
          </div>
        ) : !currentQuestion ? (
          <div className="py-8 space-y-4">
            <p className="text-sm text-gray-600">질문을 불러올 수 없습니다.</p>
            <button
              type="button"
              onClick={handleLeaveGame}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 text-white font-bold text-sm"
            >
              시작 화면으로 돌아가기
            </button>
          </div>
        ) : (
          /* ================= 게임 질문 진행 화면 (1 ~ 5번 질문) ================= */
          <div className="flex flex-col space-y-5">
            {/* 1. 상단: 진행률 표시 (예: 1/5 ~ 5/5, 진행바) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-gray-600">
                <span className="px-2.5 py-0.5 rounded-full bg-pink-100 text-pink-700">
                  {currentQuestion.category}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-extrabold text-blue-600">
                    {currentQuestionNum}/{MAX_QUESTIONS}
                  </span>
                  <button
                    type="button"
                    onClick={handleLeaveGame}
                    className="text-xs font-bold text-gray-400 hover:text-red-500 transition cursor-pointer"
                  >
                    나가기
                  </button>
                </div>
              </div>
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* 상대방이 답변한 순간 표시되는 알림 배너 ("상대방이 선택했어요!") */}
            {partnerAnswer && (
              <div
                className={`py-2 px-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-extrabold flex items-center justify-center gap-1.5 ${
                  isShaking ? "animate-shake" : ""
                }`}
              >
                <span>🔔</span>
                <span>상대방이 선택했어요!</span>
              </div>
            )}

            {/* 슬라이드 애니메이션 영역 (질문 텍스트 + 선택버튼 2개) */}
            <div
              key={currentQuestionNum}
              className={`space-y-5 ${slideAnimationClass}`}
            >
              {/* 2. 중앙: 질문 텍스트 (크게) */}
              <div className="py-5 px-2 min-h-[110px] flex items-center justify-center">
                <h2 className="text-2xl font-extrabold text-gray-900 leading-snug break-keep">
                  {currentQuestion.question}
                </h2>
              </div>

              {/* 3. 하단: 선택버튼 2개 (A선택지 / B선택지) + 호버 시 살짝 확대 및 그림자 */}
              <div className="space-y-3 px-0.5">
                {[
                  { label: "A", text: currentQuestion.option1 },
                  { label: "B", text: currentQuestion.option2 },
                ].map((item) => {
                  const isSelected = myAnswer === item.text;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      disabled={submitting || bothAnswered}
                      onClick={() => handleSelectOption(item.text)}
                      className={`w-full py-4 px-5 rounded-2xl border-2 font-bold text-base transition-all duration-200 flex items-center gap-3 text-left cursor-pointer hover:scale-[1.03] hover:shadow-lg ${
                        isSelected
                          ? "bg-blue-600 border-blue-600 text-white shadow-md"
                          : "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 text-gray-800"
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${
                          isSelected
                            ? "bg-white text-blue-600"
                            : "bg-pink-100 text-pink-700"
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="flex-1 break-keep leading-snug">
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 내 선택 후 상대방 대기 문구 */}
            {myAnswer && !bothAnswered && (
              <div className="py-3 px-4 rounded-2xl bg-pink-50 border border-pink-200 flex items-center justify-center gap-2.5">
                <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-bold text-pink-700">
                  상대방의 선택을 기다리는 중...
                </p>
              </div>
            )}

            {/* 결과 공개: 내 선택과 상대방의 선택을 나란히 표시 + 일치!/차이발견! + 3초 후 자동이동 */}
            {bothAnswered && (
              <div className="pt-1 space-y-3">
                <div
                  className={`py-2.5 px-4 rounded-xl font-extrabold text-lg ${
                    isMatched
                      ? "bg-blue-50 text-blue-600 border border-blue-200"
                      : "bg-pink-50 text-pink-600 border border-pink-200"
                  }`}
                >
                  {isMatched ? "일치!" : "차이발견!"}
                </div>

                {/* 내 선택과 상대방의 선택 나란히 표시 */}
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200">
                    <p className="text-xs font-bold text-blue-600 mb-1">
                      내 선택
                    </p>
                    <p className="text-sm font-extrabold text-gray-900 break-keep leading-snug">
                      {myAnswer}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-pink-50/70 border border-pink-200">
                    <p className="text-xs font-bold text-pink-600 mb-1">
                      상대방의 선택
                    </p>
                    <p className="text-sm font-extrabold text-gray-900 break-keep leading-snug">
                      {partnerAnswer}
                    </p>
                  </div>
                </div>

                <p className="text-xs font-semibold text-gray-400">
                  {currentQuestionNum >= MAX_QUESTIONS
                    ? `${countdown}초 후 최종 결과 화면으로 이동합니다...`
                    : `${countdown}초 후 다음 질문으로 이동합니다...`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function GamePage() {
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
      <GameScreenContent />
    </Suspense>
  );
}
