// Stand-ins for next/navigation in jsdom (the App Router context is not mounted in unit tests).
import { vi } from "vitest";

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
};

export const pathnameMock = { value: "/" };
export const searchParamsMock = { value: new URLSearchParams() };

export function resetNextMocks() {
  for (const fn of Object.values(routerMock)) fn.mockReset();
  pathnameMock.value = "/";
  searchParamsMock.value = new URLSearchParams();
}

export const navigationModule = {
  useRouter: () => routerMock,
  usePathname: () => pathnameMock.value,
  useSearchParams: () => searchParamsMock.value,
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
};
