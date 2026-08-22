import { PageHeader } from "@/components/PageHeader";
import { SocialPlatforms } from "@/components/SocialPlatforms";

export default function SocialPlatformsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Social"
        title="Platforms"
        description="Where Jarvis can publish, and what has gone out on each"
      />
      <div className="max-w-5xl px-8 pb-10">
        <SocialPlatforms />
      </div>
    </>
  );
}
