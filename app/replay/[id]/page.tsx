import Replay from "@/common/components/Replay";
import styles from "@/app/page.module.scss";

type Props = {
  params: Promise<{ id: string }>;
};

const ReplayPage = async (props: Props) => {
  const { id } = await props.params;
  return (
    <main className={styles.main}>
      <Replay id={id} />
    </main>
  );
};

export default ReplayPage;
