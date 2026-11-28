import { Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/** After this long without playable data (e.g. iOS Low Power Mode skips preloading), drop the skeleton. */
const LOADING_FALLBACK_MS = 8000;

/**
 * Makes a muted, looping product video autoplay everywhere, including iOS Safari.
 * Safari only autoplays a video that is muted when it is evaluated: the `muted` attribute,
 * the default and the property all have to be set before playback is attempted, so this sets
 * them on the element itself and then starts playback explicitly.
 *
 * The poster is the video's first frame and shows as soon as it loads, so playback starts without a
 * visible change. Until the video can play, its container shows a loading skeleton behind it
 * (`.video-loading`, see styles.css). Give the video `width`/`height` attributes so the skeleton
 * reserves the right size.
 */
@Directive({
  selector: 'video[appAutoplay]',
  host: {
    class: 'autoplay-video',
    autoplay: '',
    loop: '',
    playsinline: '',
    'webkit-playsinline': '',
    preload: 'auto',
    '[class.video-loading]': 'loading()',
    '[attr.aria-busy]': 'loading()',
  },
})
export class AutoplayVideo {
  protected readonly loading = signal(true);

  constructor() {
    const video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    afterNextRender(() => {
      const ready = () => this.loading.set(false);
      const play = () => video.play().catch(() => undefined); // blocked (e.g. Low Power Mode): poster stays
      if (video.readyState >= 3) {
        ready();
        play();
      } else {
        video.addEventListener('canplay', ready, { once: true });
        video.addEventListener('error', ready, { once: true });
        video.addEventListener('loadeddata', play, { once: true });
        setTimeout(ready, LOADING_FALLBACK_MS);
      }
    });
  }
}
