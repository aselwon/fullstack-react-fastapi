import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Workspace } from "./workspace";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("signs in, creates a request, uploads a file and changes status", async () => {
  const user = userEvent.setup();
  let ticket = {
    id: 1,
    title: "Fix my export",
    description: "Duplicate rows in export",
    status: "new",
    customer_id: 1,
    created_at: "2026-09-26T10:00:00Z",
    updated_at: "2026-09-26T10:00:00Z",
  };
  let created = false;
  let attached = false;
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method || "GET";
    calls.push(`${method} ${path}`);
    if (path !== "/auth/login")
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-token",
      );
    let body: unknown = null;
    if (path === "/auth/login")
      body = {
        access_token: "test-token",
        user: {
          id: 1,
          name: "Alex Morgan",
          email: "admin@relaydesk.local",
          role: "admin",
        },
      };
    else if (path === "/requests" && method === "POST") {
      expect(JSON.parse(init?.body as string)).toEqual({
        title: ticket.title,
        description: ticket.description,
      });
      created = true;
      body = ticket;
    } else if (path === "/requests") body = created ? [ticket] : [];
    else if (path === "/requests/1/status") {
      expect(JSON.parse(init?.body as string)).toEqual({
        status: "in_progress",
      });
      ticket = { ...ticket, status: "in_progress" };
      body = ticket;
    } else if (path === "/requests/1/attachments" && method === "POST") {
      expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
      attached = true;
      body = { id: 1 };
    } else if (path === "/requests/1/attachments")
      body = attached ? [{ id: 1, filename: "evidence.txt", size: 5 }] : [];
    else if (path === "/requests/1") body = ticket;
    else throw new Error(`Unexpected API call: ${method} ${path}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Workspace />
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: /Sign in to RelayDesk/ }),
  );
  await user.click(await screen.findByRole("button", { name: /New request/ }));
  await user.type(screen.getByLabelText("Subject"), ticket.title);
  await user.type(screen.getByLabelText("Description"), ticket.description);
  await user.click(screen.getByRole("button", { name: "Create request" }));
  const dialog = await screen.findByRole("dialog", { name: "Request RD-0001" });
  await within(dialog).findByRole("heading", { name: ticket.title });
  await user.upload(
    within(dialog).getByLabelText("Add an attachment"),
    new File(["hello"], "evidence.txt", { type: "text/plain" }),
  );
  await within(dialog).findByRole("button", { name: /evidence.txt/ });
  await user.click(
    within(dialog).getByRole("button", { name: "Mark in progress" }),
  );
  await within(dialog).findByRole("button", { name: "Mark done" });
  expect(calls).toContain("POST /requests/1/attachments");
  expect(sessionStorage.getItem("relaydesk-token")).toBe("test-token");
});
