import { PageHeader } from "@/components/PageHeader";
import { NotificationsList } from "@/components/NotificationsList";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Attention inbox"
        title="Notifications"
        description="Approvals, failures, limits, and follow-ups that need your attention"
      />
      <div className="px-8 pb-10 max-w-3xl">
        <NotificationsList />
      </div>
    </>
  );
}
