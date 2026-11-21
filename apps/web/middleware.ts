import { NextResponse, type NextRequest } from "next/server";

// Console guard: every page except /login and /register requires the
// pt_session cookie (validity is enforced by the API itself). The fixture
// harness lives at the briefed path /__dev__/states, but the App Router
// treats leading-underscore folders as private — rewrite to a routable one.
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (url.pathname.startsWith("/__dev__")) {
    url.pathname = url.pathname.replace(/^\/__dev__/, "/dev-harness");
    return NextResponse.rewrite(url);
  }
  if (url.pathname === "/login" || url.pathname === "/register") {
    return NextResponse.next();
  }
  if (!req.cookies.has("pt_session")) {
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon|icon.svg|dev-harness).*)",
};
