"use client";

import * as Dialog from "@radix-ui/react-dialog";
import classNames from "classnames";
import React, { useRef } from "react";
import { IoMdClose } from "react-icons/io";

import styles from "./styles.module.scss";

type Props = {
  isOpen: boolean;
  close: () => void;
  title: string;
  children?: React.ReactNode;
  description?: string;
  onDidPresent?: () => void;
  onDidDismiss?: () => void;
  styleOverrides?: {
    overlay?: string;
    content?: string;
  };
  container?: HTMLElement;
  disableOverlayDismiss?: boolean;
  bottomContent?: React.ReactNode;
  // TODO: Abstract entire header if we need more customization in the future.
  centerTitleText?: boolean;
};

const PREVENT_EVENTS_BUBBLING = {
  onPointerDown: (event: React.MouseEvent) => {
    event.stopPropagation();
  },
};

const UIDialog = (props: Props) => {
  const overlayLastPointer = useRef(false);
  const wasOverlayClickedRef = useRef(false);
  const overlayElRef = useRef(null);

  const handleAnimationEnd = (open: boolean) => {
    if (open) {
      props.onDidPresent?.();
    } else {
      props.onDidDismiss?.();
    }
  };

  const onClickOverlay = (event: React.MouseEvent) => {
    event.stopPropagation();

    if (wasOverlayClickedRef.current) {
      if (!props.disableOverlayDismiss) {
        props.close();
      }
    }

    overlayLastPointer.current = false;
  };

  const onClickClose = (event: React.MouseEvent) => {
    event.stopPropagation();
    props.close();
  };

  return (
    <Dialog.Root open={props.isOpen}>
      <Dialog.Portal container={props.container}>
        <Dialog.Overlay
          ref={overlayElRef}
          className={classNames(styles.overlay, props.styleOverrides?.overlay)}
          onClick={onClickOverlay}
          onPointerDown={() => {
            overlayLastPointer.current = true;
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            const targetWasOverlay = e.target === overlayElRef.current;
            const eventStartedOnOverlay = overlayLastPointer.current;

            wasOverlayClickedRef.current = eventStartedOnOverlay && targetWasOverlay;
            overlayLastPointer.current = false;
          }}
        >
          <Dialog.Content
            className={classNames(styles.contentInner, props.styleOverrides?.content)}
            {...PREVENT_EVENTS_BUBBLING}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onAnimationEnd={(e) => {
              if (e.currentTarget === e.target) {
                handleAnimationEnd(props.isOpen);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (!props.disableOverlayDismiss) {
                  props.close();
                }
              }
            }}
          >
            <div className={styles.contentInnerHeader}>
              <Dialog.Close
                className={classNames(styles.closeButton)}
                onClick={onClickClose}
                {...PREVENT_EVENTS_BUBBLING}
              >
                <IoMdClose className={styles.closeIcon} />
              </Dialog.Close>
              <Dialog.Title
                className={classNames(styles.title, {
                  [styles.centered]: props.centerTitleText,
                })}
              >
                {props.title}
              </Dialog.Title>
              {props.description && (
                <Dialog.Description className={styles.description}>
                  {props.description}
                </Dialog.Description>
              )}
            </div>

            <div className={classNames(styles.contentInnerMiddle)}>{props.children}</div>
            {props.bottomContent && (
              <div className={styles.contentInnerBottom}>{props.bottomContent}</div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default UIDialog;
export type { Props as UIDialogProps };
