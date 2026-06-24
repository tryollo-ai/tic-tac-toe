import RoomGame from "@/common/components/RoomGame/RoomGame";
import styles from "@/app/page.module.scss";

const RoomPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  return (
    <main className={styles.main}>
      <RoomGame id={id} />
    </main>
  );
};

export default RoomPage;
