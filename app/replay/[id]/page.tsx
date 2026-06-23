import Replay from "@/components/Replay/Replay";
import styles from "@/app/page.module.scss";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className={styles.main}>
      <Replay id={id} />
    </main>
  );
}
