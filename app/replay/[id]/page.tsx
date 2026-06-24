import Replay from "@/common/components/Replay/Replay";
import styles from "@/app/page.module.scss";

const ReplayPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  return (
    <main className={styles.main}>
      <Replay id={id} />
    </main>
  );
};

export default ReplayPage;
