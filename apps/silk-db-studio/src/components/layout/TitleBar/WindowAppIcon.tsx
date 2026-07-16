type WindowAppIconProps = {
  src?: string;
};

function WindowAppIcon({ src = "/app-icon.png" }: WindowAppIconProps) {
  return (
    <div className="window-app-icon" aria-hidden>
      <img
        className="window-app-icon__image"
        src={src}
        alt=""
        draggable={false}
      />
    </div>
  );
}

export default WindowAppIcon;
