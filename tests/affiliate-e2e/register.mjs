// 테스트 전용: 실제 DB · 로그인 대신 PGlite 와 테스트 로그인을 끼운다.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
