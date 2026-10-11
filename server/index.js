import { app } from "./app.js";
const port = Number(process.env.PORT) || 4310;
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`CRM API: http://127.0.0.1:${port}`));
