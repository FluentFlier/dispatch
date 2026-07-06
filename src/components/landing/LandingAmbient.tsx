import Image from 'next/image';

export default function LandingAmbient() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Image
        src="/landing/hero-bg.png"
        alt=""
        fill
        priority
        className="object-cover object-[center_28%] scale-105 animate-land-kenburns"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-paper/10 via-paper/40 to-paper" />

      <div className="absolute -left-32 top-[18%] h-[420px] w-[420px] rounded-full bg-blue/12 blur-[100px] animate-land-drift-a" />
      <div className="absolute -right-24 top-[42%] h-[360px] w-[360px] rounded-full bg-teal/10 blur-[90px] animate-land-drift-b" />
      <div className="absolute bottom-[8%] left-[30%] h-[280px] w-[280px] rounded-full bg-blue/8 blur-[80px] animate-land-drift-c" />

      <div className="absolute inset-0 opacity-[0.35] mix-blend-soft-light">
        <Image
          src="/landing/mesh.png"
          alt=""
          fill
          className="object-cover object-center animate-land-mesh"
          sizes="100vw"
        />
      </div>
    </div>
  );
}
