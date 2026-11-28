// Dev-server proxy: /api → the Nest API (override with API_URL, e.g. for E2E runs).
export default {
  '/api': { target: process.env.API_URL ?? 'http://localhost:3000', secure: false, changeOrigin: true },
};
