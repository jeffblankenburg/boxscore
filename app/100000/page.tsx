import Image from "next/image";

export const metadata = {
  title: "100,000 emails — boxscore",
  description:
    "boxscore has now delivered 100,000 email digests. Thanks for reading.",
  openGraph: {
    title: "100,000 emails — boxscore",
    description:
      "boxscore has now delivered 100,000 email digests. Thanks for reading.",
    images: ["/100000.png"],
  },
};

export default function MilestonePage() {
  return (
    <article style={{ textAlign: "center", padding: "24px 0 48px" }}>
      <Image
        src="/100000.png"
        alt="100,000 emails delivered"
        width={1024}
        height={1536}
        priority
        sizes="(max-width: 640px) 92vw, 600px"
        style={{
          width: "100%",
          maxWidth: 600,
          height: "auto",
          margin: "0 auto",
          display: "block",
        }}
      />
    </article>
  );
}
