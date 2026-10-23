import { Router, type Request, type Response } from "express";
import type { Fixtures } from "./store.js";
import { renderLinearPage } from "./pages/linear.js";

/** `GET /linear/issue/:key` — renders a seeded Linear ticket page. */
export function createLinearRouter(fixtures: Fixtures): Router {
  const router = Router();

  router.get("/issue/:key", (req: Request, res: Response) => {
    const ticket = fixtures.linear.tickets.find((t) => t.key === req.params.key);
    if (!ticket) {
      res.status(404).send("Not Found");
      return;
    }
    res.type("html").send(renderLinearPage(ticket));
  });

  return router;
}
