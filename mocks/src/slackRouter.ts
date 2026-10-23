import { Router, type Request, type Response } from "express";
import type { Fixtures } from "./store.js";
import { renderSlackPage } from "./pages/slack.js";

/** `GET /slack/archives/:channel/p:ts` — renders a seeded Slack thread page. */
export function createSlackRouter(fixtures: Fixtures): Router {
  const router = Router();

  router.get("/archives/:channel/p:ts", (req: Request, res: Response) => {
    const { channel, ts } = req.params;
    const thread = fixtures.slack.threads.find((t) => t.channel === channel && t.ts === ts);
    if (!thread) {
      res.status(404).send("Not Found");
      return;
    }
    res.type("html").send(renderSlackPage(channel, thread));
  });

  return router;
}
