# 잔화 공방 베타 배포 체크리스트

## 1. Supabase

기존 DB를 초기화하지 말고 SQL Editor에서 아직 실행하지 않은 마이그레이션만 순서대로 실행합니다.

```text
001_initial_schema.sql
002_leaderboard_realtime.sql
003_reforge_grades.sql
004_seed_tower_content.sql
005_repair_game_rpcs.sql
006_fix_ambiguous_rpc_columns.sql
007_relic_forge_loop.sql
008_summon_pity.sql
```

처음 배포한 DB에 001~006이 이미 적용되어 있다면 `007`, `008`만 실행합니다.

Supabase Dashboard에서 다음도 확인합니다.

- Authentication → Providers → Anonymous Sign-Ins 활성화
- Realtime에서 `leaderboard_profiles` 변경 감지 활성화
- `service_role` 키는 Render 환경변수에만 저장
- `SUPABASE_ANON_KEY`는 브라우저 설정 응답에 사용 가능하지만 service role 키와 혼동하지 않기

## 2. Render 환경변수

```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Start Command는 `npm start`를 사용합니다. 서버는 Render가 제공하는 `PORT`를 자동으로 사용합니다.

## 3. 브라우저 스모크 테스트

1. 새 브라우저 또는 시크릿 창에서 닉네임으로 익명 계정을 생성합니다.
2. 장비 선반에서 장비를 선택합니다.
3. `선택 장비 강화`, `옵션 재련`, `금고 열기`를 각각 한 번씩 실행합니다.
4. 금고 결과에서 희귀도, 옵션, 소환 기록을 확인합니다.
5. 원정을 실행해 무기 공격 이펙트가 결과창보다 먼저 재생되는지 확인합니다.
6. 다른 브라우저에서 다른 닉네임으로 접속해 랭킹 행을 누르고 연구 창을 확인합니다.
7. 모바일 폭에서 공방 버튼이 겹치지 않는지 확인합니다.

## 4. 로컬 검증

```bash
npm install
npm run check
npm test
```

