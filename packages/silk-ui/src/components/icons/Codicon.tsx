import "@vscode/codicons/dist/codicon.css";
import "./Codicon.css";

type CodiconProps = {
  name: string;
  className?: string;
};

type CustomIcon = { viewBox: string; path: string };

/**
 * Icons codicons doesn't have — rendered as an inline single-path SVG instead of the codicon
 * font, but sized/colored (`currentColor`) to match every other codicon exactly.
 */
const CUSTOM_ICONS: Record<string, CustomIcon> = {
  filter: {
    viewBox: "0 0 16 16",
    path: "M9.5 14H6.5C6.224 14 6 13.776 6 13.5V9.329C6 8.928 5.844 8.552 5.561 8.268L1.561 4.268C1.205 3.911 1 3.418 1 2.914C1 1.858 1.858 1 2.914 1H13.086C14.142 1 15 1.858 15 2.914C15 3.417 14.796 3.911 14.439 4.267L10.439 8.267C10.156 8.551 10 8.927 10 9.328V13.499C10 13.775 9.776 13.999 9.5 13.999V14ZM7 13H9V9.329C9 8.661 9.26 8.033 9.732 7.561L13.732 3.561C13.902 3.391 14 3.155 14 2.915C14 2.411 13.59 2.001 13.086 2.001H2.914C2.41 2.001 2 2.411 2 2.915C2 3.155 2.098 3.391 2.268 3.562L6.268 7.562C6.741 8.034 7 8.662 7 9.33V13.001V13Z",
  },
};

/**
 * DB vendor icons — each connection driver's official favicon (16px frame, extracted from the
 * vendor's own site) instead of a scaled-down logo silhouette. A full logo mark reads as an
 * unrecognizable blob at 16px (this was tried first — see git history); a favicon is already
 * designed by the vendor to read correctly at exactly this size, which a generic logo isn't.
 */
const IMAGE_ICONS: Record<string, string> = {
  "db-oracle":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABX0lEQVR4nNVROywDUBQ95/kkQlekyiBpwmwQSROiHzabVier1Wdik9iISQwMJtUubJKqSEwkBhaDsT8sEgPS35HXqoT6dJI4070v55x37r3AvwerRSrk90KlOYKDoFq+ZIvPgs5As+qKxBPvBpmgb1HEsu0J3Qq8B1TzF6F2gZ1lK2jJGUmsMBP0B0QdEngslDTdHU0csFZdCQAwO+WdkLgDwIGixoyMFqy9yJmeaGL/O/FbXDl3y5yZctvAeQNhSMCLM5uP1bu4zM2D5b5AGjIAmoyUx8lJsV6DgYuLAoACyCZrcCXSkQr5hus1SE96RwC0Abi0I2y8zbedDPvdv4nvw363MdyytVDapN1sJuTbBRAUkCNwLOju8zItj2CHgFECzRAjzr14uNES1ecJZ69Pz0HOAhi3F/+M6guBtKS1rn7POhHXB2YlTcCVy+dav4pfMo1PvbGj5E+n/nu8Asc8iKCAcDayAAAAAElFTkSuQmCC",
  "db-mysql":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAADQklEQVR4nD2TT2xUVRTGf/e++/7MdKb/cNpYMVZRtAI2ChZJGkMCpgYs6oKkMSysJkKMGl26cOXGWFygIoluXChiYjTQNHEDSCiVGlMLVgomMk5thU5nptP5w5t589675g3Es7o5yXe/73znO+K5j77Wv8zfIB6E3KrUyJarELNBSAhDUBLDNsGQhEGIIGqHdHUkeWZzL6L3rU/1oZ39PHZfN+Vag/GZa1xKZ1GmhVutspItkK81wDQwHBstBWHDRxkGna1xVIcT4+G71/Hu8dPcm2rn9d1b2f9kgOf53JNqI71S5KupOS7OXmd1rYZM2kjTwA9CsqtlRPvI+/rtFwcpVFyOnjjDXYk4TncHfs3DsS129T/AS4NbWFqrMPbDBWavLiCTMYRtogONLHoNPhv/mU3rU7yxfyfLa1VSbS3s3rqRv2/m+OLkFAcOf8ul9CJfvrmP0T0D6LKLrjcQhkCpRIxsscqH353jg1f3cubaIn9mlgk1OB2t3HI9Fis1xo6f43I6x+HRZ0k5NmPfn0cgkKHWGIkYfy0Xmfj1Ci8/vRm/4jJzNYMbbSEyLxFHtCX4cXKOQ8cmGB0a4MDQNoJCCRnNETkrLMWpqXnitsXzux7HNBXa84mkBH4DbBMz1crk9B+8981PvDO8g0ce7EFyZ6/SsShUPD4ev8jIjk30b1yP9gMMQyCFaL5DU2GsS3Lq/G+c/T3NJweHkVEyhBAgZTM02ZsFlnIllFLNvg41OmIREPoBIm7jGQZHTk7RkYih+L80kR4rGafS8FnOl9D1gCDCKtkkiD5rptGxuFGq8srn4xHkNkuzItOCAFsZ1Bo+XV1JXhh4CMsPIAiRyritSEDgWFxeWEHqSNcdfMRSdz1Kbp3uzgTb+3o59to+tm3oQRcryKZKgZACrXV0LoEynIQR1l10GCIsk9V6yNn5BUa2P0rZ9VjNlzk4NEA6V+LfYhVpKbSIfBFIK27I1ridkUL6YRRLKcAUTM5dx617jDzVx9HTM5yYnmdkcAuptmTzkISQKGn4bS1ORln1/N5ke+d4xfXu992qL01DRes/MjHN7FKeC1cy5BZz5J7YQF9PknLN9T3lqNYW+5+Wen74P5uyeaYOoWRXAAAAAElFTkSuQmCC",
  "db-mariadb":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABAklEQVR4nM3RvyvGURTH8Re+9SQT2WRgk4HlW2yWr79AyGqhGAzyH8hil8Xkn3AHWSw3UsiPwWYjymLwq/v0ffJNT/FYOHXrns55f87n3MtfR9uvybzoQK11gbwYxhSGcJ61CCdoFyM4xdbPBfKihtUSvsKcGM7aW5g/XZ4UBwlOl+ybqak+iBksoausHDVasiZQcjWACUxiHH1ouL1DbC6Q1/dcwAr6K9BbpWsfF58CedGLbjxiFut4xRM68YLb0kXAhhieqw5GsVk232MNh+X0JN6DZRxjUQwPVdMZbnCNS+yIIeXVtcawh+2vcEMg2ZuvW47hvclfnNQfLYa01j+MD48dO7eipOh6AAAAAElFTkSuQmCC",
  "db-postgresql":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA70lEQVR4nJVTCRKDMAjc8DHzM+PP8GXtLJDbtlPGUQJhgQUTQo7jeOWcTVdV3PedRtso1U898XWe5wvIUCj4ZQjjCo9Qt9CofOIMxXVdybIgF/eGMCuzrOKBDuInhXiJ++UnscDWkcfIpywErvpYmbUXb1YpNWxAgFXvVU7QzkHlASQSQpTpXhDnfS6OqVtTktRx/CNGX5AsIyFVe5q9+VhtuGpiaY7WiLdUgrBnUdsdroB0NJ12gBX2tVp76LY02onqZfYLM5WcRGnlbwBYxLe0gzl5M8C2SFu1Swvr1L4C7CPeV/7nDoy/NP++1f8GAfx5Z8B1Z54AAAAASUVORK5CYII=",
  "db-sqlserver":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARUlEQVR4nGP87if3nwEH4Nz0iLF+FwNO+UY3BkYmBgoB06gBDBSHAcWAkWHJe5zxzBAjyPh/J+50wOg+mg5AYOCTMsUAAKgRDRsEgKEHAAAAAElFTkSuQmCC",
};

function Codicon({ name, className }: CodiconProps) {
  const classes = ["codicon", `codicon-${name}`, className]
    .filter(Boolean)
    .join(" ");
  const custom = CUSTOM_ICONS[name];
  const image = IMAGE_ICONS[name];

  if (image) {
    return (
      <span className={`${classes} codicon--svg codicon--favicon`} aria-hidden>
        <img src={image} width={16} height={16} alt="" />
      </span>
    );
  }

  if (custom) {
    return (
      <span className={`${classes} codicon--svg`} aria-hidden>
        <svg viewBox={custom.viewBox} fill="currentColor" aria-hidden>
          <path d={custom.path} />
        </svg>
      </span>
    );
  }

  return <span className={classes} aria-hidden />;
}

export default Codicon;
