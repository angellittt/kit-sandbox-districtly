import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import { noDirectAxios } from "../no-direct-axios.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = { messageId: "noDirectAxios" as const };

ruleTester.run("no-direct-axios", noDirectAxios, {
  valid: [
    'import { api } from "@/lib/axios";',
    'import { api } from "../lib/axios";',
    'import type { AxiosError } from "axios";',
    'import { type AxiosResponse } from "axios";',
    'export type { AxiosError } from "axios";',
    'export { type AxiosError } from "axios";',
    'import axiosRetry from "axios-retry";',
    'const client = await import("@/lib/axios");',
    "const client = await import(`@/lib/axios`);",
    'const lib = "axios"; const client = await import(`${lib}`);',
  ],
  invalid: [
    { code: 'import axios from "axios";', errors: [error] },
    { code: 'import { isAxiosError } from "axios";', errors: [error] },
    { code: 'import * as axios from "axios";', errors: [error] },
    { code: 'import "axios";', errors: [error] },
    {
      code: 'import axios, { type AxiosError } from "axios";',
      errors: [error],
    },
    {
      code: 'import { create } from "axios/unsafe/axios.js";',
      errors: [error],
    },
    { code: 'export { default } from "axios";', errors: [error] },
    {
      code: 'export { isAxiosError, type AxiosError } from "axios";',
      errors: [error],
    },
    { code: 'export * from "axios";', errors: [error] },
    { code: 'const axios = await import("axios");', errors: [error] },
    { code: 'const axios = require("axios");', errors: [error] },
    { code: "const axios = await import(`axios`);", errors: [error] },
    { code: "const axios = require(`axios`);", errors: [error] },
    {
      code: "const unsafe = require(`axios/unsafe/axios.js`);",
      errors: [error],
    },
  ],
});
