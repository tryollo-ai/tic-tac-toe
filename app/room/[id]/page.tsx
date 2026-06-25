import RoomGame from "@/common/components/RoomGame";
import styles from "@/app/page.module.scss";

type Props = {
  params: Promise<{ id: string }>;
};

const RoomPage = async (props: Props) => {
  const { id } = await props.params;
  return (
    <main className={styles.roomMain}>
      <RoomGame id={id} />
    </main>
  );
};

export default RoomPage;
