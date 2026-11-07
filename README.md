# ⚖️ 취향 밸런스 게임 (Preference Balance Game)

두 사람이 실시간으로 같은 방에 접속해 **음식 · 여행 · 생활방식 · 로맨스 · 여가활동** 5개 카테고리의 밸런스 질문을 풀고, 서로의 취향 일치율을 확인하는 실시간 웹 애플리케이션입니다.

---

## 📸 주요 화면 캡처

| 1. 로그인 / 회원가입 (원클릭 테스트 계정 지원) | 2. 메인 로비 (방 만들기 / 참가하기) |
| :---: | :---: |
| ![로그인 화면](./public/screenshots/01-login.png) | ![메인 로비](./public/screenshots/02-lobby.png) |

| 3. 대기실 (4자리 방 코드 공유 & 자동 카운트다운) | 4. 실시간 밸런스 질문 화면 |
| :---: | :---: |
| ![대기실 화면](./public/screenshots/03-waiting-room.png) | ![질문 화면](./public/screenshots/04-game-question.png) |

| 5. 질문 전환 슬라이드 애니메이션 | 6. 최종 결과 화면 (일치율 · 카테고리 그래프 · TOP 3) |
| :---: | :---: |
| ![질문 전환 화면](./public/screenshots/05-game-reveal.png) | ![최종 결과 화면](./public/screenshots/06-final-result.png) |

---

## ✨ 주요 기능

### 1. 🔐 Supabase Auth & RLS 보안
- **이메일 로그인 / 회원가입**: Supabase Auth 기반 사용자 인증 및 세션 유지
- **원클릭 테스트 계정**: 별도 가입 없이 바로 2인 테스트가 가능한 `Player 1 계정` / `Player 2 계정` 빠른 로그인 버튼 제공
- **Row Level Security (RLS)**: `public.rooms` 및 `public.answers` 테이블에 RLS 정책(`TO authenticated`)을 적용하여 인증된 사용자만 방 생성/참가 및 답변 등록 가능

### 2. 🏠 방 생성 & 실시간 입장 감지
- **4자리 영문 대문자 + 숫자 방 코드**: 예) `A387`, `GEM8` (소문자로 입력해도 자동 대문자 변환)
- **3초 자동 카운트다운 시작**: 상대방(Player 2)이 입장하면 별도의 시작 버튼 없이 양쪽 화면에서 `3 → 2 → 1` 카운트다운 후 동시에 게임 시작
- **빈 방 자동 정리**: 방 생성 후 10분 동안 아무도 참가하지 않으면 대기 상태의 방을 DB에서 자동 삭제

### 3. 🎮 실시간 게임 플레이 & 인터랙션
- **100개 밸런스 질문 데이터 (`questions.csv`)**: 음식, 여행, 생활방식, 로맨스, 여가활동 각 20문항씩 총 100문항 수록
- **슬라이드 애니메이션**: 질문이 바뀔 때 현재 질문은 왼쪽으로 사라지고 다음 질문은 오른쪽에서 등장
- **상대방 선택 알림 효과**: 상대방이 먼저 답변을 선택하면 진동 효과(CSS Shake)와 함께 `"🔔 상대방이 선택했어요!"` 배너 표시
- **답변 동시 공개 & 자동 진행**: 두 사람 모두 선택하면 `"🎉 일치!"` 또는 `"⚡ 차이발견!"` 결과와 함께 양쪽 선택을 비교 표시하고 3초 후 다음 질문으로 자동 이동
- **이탈 방지 경고**: 게임 진행 중 나가기 또는 브라우저 뒤로가기 시 `"게임이 진행중입니다. 정말 나가시겠습니까?"` 확인창 표시

### 4. 📊 최종 결과 리포트
- **전체 취향 일치율 & 맞춤 멘트**:
  - `90% 이상`: **"환상의 짝꿍"**
  - `70% ~ 89%`: **"꽤 잘맞는 사이"**
  - `50% ~ 69%`: **"다름이 매력적인 사이"**
  - `50% 미만`: **"서로 알아가고 있는 사이"**
- **카테고리별 일치율 막대그래프**: 음식, 여행, 생활방식, 로맨스, 여가활동 각각의 일치율 시각화
- **가장 다른 답변이 나온 질문 TOP 3**: 두 사람의 선택이 엇갈렸던 대표적인 질문과 각자의 선택 비교
- **다시 도전하기 & 결과 공유하기**: 클릭 한 번으로 새 방을 생성해 재도전하거나 결과를 클립보드/공유 API로 공유

---

## 🛠️ 기술 스택

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend / Database**: Next.js Route Handlers (`/api/rooms`, `/api/game`), PostgreSQL (`pg`), Supabase Realtime, Supabase Auth & RLS

---

## 🚀 시작하기

### 1. 패키지 설치

```bash
npm install
```

### 2. 환경 변수 설정 (`.env.local`)

프로젝트 루트에 `.env.local` 파일을 생성하고 Supabase 프로젝트 정보를 입력합니다:

```env
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"

NEXT_PUBLIC_SUPABASE_URL="https://[PROJECT_REF].supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your_supabase_anon_or_publishable_key"
```

### 3. 데이터베이스 스키마 적용

Supabase SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql) 파일의 내용을 실행하여 `rooms`, `answers` 테이블과 Realtime 및 RLS 정책을 생성합니다.

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3005](http://localhost:3005) 로 접속합니다.
