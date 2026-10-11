import { app } from "./app.js";
const port = Number(process.env.PORT) || 4310;
app.listen(port, "127.0.0.1", () =>
  console.log(`CRM API: http://127.0.0.1:${port}`),
);
