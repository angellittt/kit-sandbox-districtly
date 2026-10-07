import {
  render as rtlRender,
  type RenderOptions,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement } from "react";

export const render = async (ui: ReactElement, options?: RenderOptions) => {
  const user = await userEvent.setup();
  return {
    user,
    ...rtlRender(ui, options),
  };
};

// re-export everything from RTL
export * from "@testing-library/react";
