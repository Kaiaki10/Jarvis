import { PageHeader } from "@/components/PageHeader";
import { NotificationsList } from "@/components/NotificationsList";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Anything that needed you, including while you were away"
      />
      <div className="px-8 pb-10 max-w-3xl">
        <NotificationsList />
      </div>
    </>
  );
}
