# 잔화 공방 / Ashen Foundry (Beta)

짧은 원정, 장비 소환, 재련, 비동기 랭킹을 하나의 루프로 묶은 서버 권위형 웹게임입니다. 클라이언트는 결과를 저장하지 않으며, `service_role` 키는 서버에서만 사용합니다.

## 시작

1. Supabase 프로젝트에서 `supabase/migrations/001_initial_schema.sql`, `002_leaderboard_realtime.sql`, `003_reforge_grades.sql`, `004_seed_tower_content.sql`, `005_repair_game_rpcs.sql`, `006_fix_ambiguous_rpc_columns.sql`, `007_relic_forge_loop.sql`, `008_summon_pity.sql`을 순서대로 실행합니다.
2. `.env.example`을 `.env`로 복사하고 키를 입력합니다.
3. `npm install` 후 `npm run dev`를 실행합니다.

## API

- `GET /health`
- `POST /v1/tower/challenge` — Bearer 인증, `{ "floor": 1, "item_id": "uuid" }`
- `POST /v1/items/reforge` — Bearer 인증, `{ "item_id": "uuid" }`
- `POST /v1/armory/draw` — Bearer 인증, `{ "cost": 100 }`
- `POST /v1/armory/upgrade` — Bearer 인증, `{ "item_id": "uuid" }`
- `GET /v1/items` — 보유 아이템 목록
- `GET /v1/tower/state` — 현재 층·보스·유저 자원
- `GET /v1/leaderboard` — 공개 최고 층수 및 대표 세팅

상성 배율은 유리 `1.25`, 불리 `0.85`, 중립 `1.0`으로 고정되어 있습니다. 재련과 전투 결과 반영은 PostgreSQL RPC에서 원자적으로 수행됩니다.

재련 등급 확률은 C 52%, B 30%, A 12%, S 5%, SS 1%입니다. 앱솔루트 소울은 6% 확률로 등장하며, SS 등급에서는 Void Heart 강화 효과가 적용됩니다. 화면에서는 C/B/A/S/SS가 각각 기본 파편, 청색 충격, 희귀 광원, 황금 섬광, 암흑 보라색 컷으로 구분됩니다.

소환 기록은 `summon_progress`에 서버에서 잠금 처리됩니다. 10회째에는 영웅 이상, 50회째에는 유물 등급을 보장해 단순한 운빨만으로 끝나지 않게 했습니다.

## Beta 화면

`npm start` 실행 후 `/`에 접속하면 잔화 공방 화면이 열립니다. 첫 접속 시 닉네임만 입력하면 Supabase 익명 계정과 프로필이 자동으로 만들어집니다. 세션은 Supabase 클라이언트가 브라우저에 저장하므로 다음 방문부터 자동 복원됩니다. Supabase Dashboard에서 Anonymous Sign-Ins를 활성화해야 합니다.

Render와 Supabase 반영 순서는 `DEPLOY_CHECKLIST.md`에 정리되어 있습니다.

랭킹은 공개 `leaderboard_profiles` 테이블을 Supabase Realtime으로 구독합니다. 최고 층수 갱신 시 별도 새로고침 없이 목록과 대표 세팅이 갱신되고, 다른 유저의 행을 클릭하면 연구용 세팅 팝업이 열립니다.
