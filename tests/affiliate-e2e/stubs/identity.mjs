// 테스트에서는 Netlify Identity 로그인이 없다.
export * from "@netlify/identity?real";
export const getUser = async () => null;
