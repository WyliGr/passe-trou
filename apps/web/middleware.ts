import { NextResponse, type NextRequest } from "next/server";

// The fixture harness lives at the briefed path /__dev__/states, but the App
// Router treats leading-underscore folders as private — rewrite to a routable one.
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = url.pathname.replace(/^\/__dev__/, "/dev-harness");
  return NextResponse.rewrite(url);
}

export const config = { matcher: "/__dev__/:path*" };
