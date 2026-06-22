import RoomGame from "@/components/RoomGame/RoomGame";
import styles from "@/app/page.module.scss";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className={styles.main}>
      <RoomGame id={id} />
    </main>
  );
}
