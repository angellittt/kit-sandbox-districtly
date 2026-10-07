import { z } from "zod";
import validate from "express-zod-safe";

// Convention: define a zod schema per route, then wrap it with
// `express-zod-safe`'s `validate({ body, params, query })` and use the
// result as route middleware. It validates the request and gives handlers
// typed, parsed `req.body`/`req.params`/`req.query`, e.g.:
//
//   export const validateListWidgets = validate({ query: paginationQuerySchema });
//   router.get("/widgets", validateListWidgets, listWidgets);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Ready-to-use example of the convention above - apply this to any route
// that returns a paginated list.
export const validatePagination = validate({ query: paginationQuerySchema });
