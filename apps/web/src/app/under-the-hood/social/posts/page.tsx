import { PageHeader } from "@/components/PageHeader";
import { SocialPosts } from "@/components/SocialPosts";

export default function SocialPostsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Social"
        title="Posts"
        description="Everything Jarvis has written, from idea through published"
      />
      <div className="max-w-5xl px-8 pb-10">
        <SocialPosts />
      </div>
    </>
  );
}
