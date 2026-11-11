import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./OperationProjects";
import { PJ } from "./projects";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => (path.startsWith("/api/operation/projects/masters") ? { masters: [] } : path.startsWith("/api/operation/projects") ? { projects: [] } : {})),
}));

describe("Project List with no projects", () => {
  it("shows one empty card with New project, and no side column repeating the zeros", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/operation?tab=projects"]}><ProjectsPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(PJ.noProjects)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: PJ.newProject })).toHaveLength(2); // the toolbar and the empty card
    expect(screen.queryByText(PJ.total)).not.toBeInTheDocument();
    expect(screen.queryByText(PJ.noUpcoming)).not.toBeInTheDocument();
  });
});
