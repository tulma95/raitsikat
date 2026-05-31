// `/fi` is the explicit Finnish URL; canonical content lives at `/`.
// 301 consolidates link equity and removes any chance of crawler
// duplicate-content confusion.
export const prerender = false;

export const GET = () =>
  new Response(null, { status: 301, headers: { Location: "/" } });
