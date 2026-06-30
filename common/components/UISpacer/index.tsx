import React from 'react';

export type Props = {
  w?: number;
  h?: number;
  className?: string;
  inline?: boolean;
};

const UISpacer = (props: Props) => {
  const { w, h, className, inline, ...remainingProps } = props;

  // If neither a width nor height are provided, clearly, we don't want to render anything.
  if (!w && !h) {
    return null;
  }

  return (
    <div
      {...remainingProps}
      className={className}
      style={{
        height: w ? undefined : `${h}px`,
        width: h ? '100%' : `${w}px`,
        flex: '0 0 auto',
        display: inline ? 'inline-block' : undefined,
      }}
    />
  );
};

export default UISpacer;
