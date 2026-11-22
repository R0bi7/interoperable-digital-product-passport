import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge, VerificationBadge } from "./badges";

describe("VerificationBadge", () => {
  it.each(["verified", "failed", "unavailable"] as const)(
    "renders %s with its reason",
    (status) => {
      const html = renderToStaticMarkup(
        <VerificationBadge name="content" check={{ status, reason: "because <reason>" }} />,
      );
      expect(html).toContain(`data-check="content"`);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(`content: ${status}`);
      expect(html).toContain(`title="because &lt;reason&gt;"`);
    },
  );
});

describe("StatusBadge", () => {
  it("labels in_flight as 'in flight'", () => {
    expect(renderToStaticMarkup(<StatusBadge status="in_flight" />)).toContain(">in flight<");
    expect(renderToStaticMarkup(<StatusBadge status="held" />)).toContain(">held<");
    expect(renderToStaticMarkup(<StatusBadge status="incomplete" />)).toContain(">incomplete<");
  });
});
