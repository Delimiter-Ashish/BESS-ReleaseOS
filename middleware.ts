import { NextResponse, type NextRequest } from "next/server";

/** Passes the request path to server layouts so public routes (/p/:id) render without workspace data. No auth decisions here. */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-ros-path", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|pdf.worker.min.mjs).*)"] };
