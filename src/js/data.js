const portfolioData = {
  personal: {
    name: "Ali Koaik",
    location: "Lebanon",
    email: "alikoaik004@gmail.com",
    status: "Open to opportunities",
    degree: "B.Sc. Computer Science",
    /* The line under the name on the galaxy page's name screen. */
    headline: "Computer Science student · Low\u2011level & systems programming",   // \u2011: a hyphen that does not break the line
    /* The pilot's portrait on the orbital dashboard (galaxy.html).
       Drop the photo at src/assets/portrait.jpg; until it exists the
       dashboard shows the initials instead. */
    photo: "assets/portrait.jpg",
    resume: "assets/Ali_Koaik_CV.pdf",
    /* One line for the dashboard; the full story is `bio` below. */
    brief: "Computer Science student in Lebanon, at USAL and 42 Beirut. Low-level programming, systems design, and building things from scratch.",
    bio: [
      "Computer Science student based in Lebanon, studying at both the University of Science and Arts in Lebanon and 42 Beirut — a project-based, peer-to-peer coding school known for its intensive curriculum.",
      "Passionate about low-level programming, systems design, and building things from scratch. Deep interest in memory management in C, multithreading, and shell pipelines. Also explores Python applications and web development.",
      "Believes great software is built with curiosity, persistence, and clean code. Always looking for new challenges that push growth."
    ]
  },

  /* The world the trip arrives at — the star of the system (system.js
     draws it; galaxy.html captions it). Generated, not a real place. */
  planet: {
    name: "Koaik",
    caption: "A mini black hole at the heart of it all",
    hint: ""     /* nothing follows the dashboard yet; a hint here shows a chevron under it */
  },

  socials: {
    email: "alikoaik004@gmail.com",
    github: "https://github.com/alikoaikk",
    linkedin: "https://www.linkedin.com/in/alikoaik"
  },

  stats: {
    level42: 5,
    projects: "9+",
    languages: "5+",
    universities: 2
  },

  education: [
    {
      institution: "42 Beirut",
      program: "Architecture of Digital Technologies Program · 42 Core Curriculum",
      period: "2025 – Present",
      level: "Level 5",
      badge: "Project-Based & Peer-to-Peer Learning",
      /* The school's mark beside its entry in the timeline (galaxy.html).
         `logoTile: "light"` puts it on a white tile — for a logo drawn
         for a white page; without it the tile is dark. No `logo` → the
         tile shows the initials. */
      logo: "assets/logos/42.svg",
      /* Shown when the card is hovered (galaxy.html, profile.js). */
      description: "A project-based, peer-to-peer coding school with no lectures or teachers. Learning happens through hands-on projects, collaboration, and peer review — pushing students through systems programming, algorithms, and real-world software engineering."
    },
    {
      institution: "University of Science and Arts in Lebanon",
      program: "Bachelor of Science in Computer Science – Computing",
      period: "2022 – Present",
      badge: "Computer Science – Computing",
      logo: "assets/logos/usal.webp",
      logoTile: "light",
      description: "A traditional university offering a structured Computer Science curriculum covering algorithms, data structures, software engineering, databases, operating systems, and networking — building a solid theoretical and practical foundation in computing."
    }
  ],

  projects: [
    {
      name: "MINISHELL",
      icon: "🐚",
      tagline: "A Unix shell in C",
      type: "Systems · shell",
      description: "A fully functional Unix shell built in C, replicating core Bash behavior — command execution, pipes, redirections, environment variables, built-in commands, and signal handling. One of the most comprehensive systems projects.",
      tech: ["C", "Bash", "Processes", "Pipes", "Unix"],
      github: "https://github.com/akoaik-msafa/minishell"
    },
    {
      name: "CPP MODULES",
      icon: "⚙️",
      tagline: "Object-oriented C++, module by module",
      type: "Language · OOP",
      description: "42 School C++ modules covering OOP fundamentals — classes, memory allocation, operator overloading, inheritance, polymorphism, and abstract classes. A structured progression through modern C++ concepts.",
      tech: ["C++", "OOP", "Inheritance", "Polymorphism"],
      github: "https://github.com/Alikoaikk/cpp"
    },
    {
      name: "SO_LONG",
      icon: "🎮",
      tagline: "2D game in C · MiniLibX",
      type: "Game",
      description: "A Harry Potter-themed 2D top-down game in C using the MiniLibX graphics library. Features sprite rendering, four-directional movement, map validation via .ber files, collision detection, and a move counter.",
      tech: ["C", "MiniLibX", "Graphics", "Game Dev"],
      github: "https://github.com/Alikoaikk/SO_LONG",
      demo: "https://youtu.be/S8EFh6rSWDw?si=6wL2AtSBFscp3dZJ"
    },
    {
      name: "PUSH_SWAP",
      icon: "🔢",
      tagline: "Sorting with two stacks",
      type: "Algorithm",
      description: "Sorts a stack of integers using only two stacks and a minimal set of operations. Implements radix sort for large sets (100+ numbers) and optimized algorithms for small sets — achieving O(n log n) efficiency.",
      tech: ["C", "Algorithms", "Sorting", "Stacks"],
      github: "https://github.com/Alikoaikk/PUSH_SWAP"
    },
    {
      name: "PHILOSOPHERS",
      icon: "🧵",
      tagline: "Dining philosophers on POSIX threads",
      type: "Concurrency",
      description: "Multithreaded Dining Philosophers simulation in C using POSIX threads and mutexes. Handles race conditions, deadlock prevention, and precise timing — a deep dive into concurrent programming.",
      tech: ["C", "Threads", "Mutexes", "POSIX"],
      github: "https://github.com/alikoaikk/PHILOSOPHERS"
    },
    {
      name: "C_FULL_LIB",
      icon: "📚",
      tagline: "libft + ft_printf + get_next_line",
      type: "Library",
      description: "A unified C library combining libft, ft_printf, and get_next_line into one reusable static library — string manipulation, formatted output, and line-by-line file reading all in one package.",
      tech: ["C", "Variadic", "File I/O", "Static Lib"],
      github: "https://github.com/Alikoaikk/C_Full_Lib"
    },
    {
      name: "PIPEX",
      icon: "🔗",
      tagline: "Shell pipelines in C",
      type: "Systems · processes",
      description: "Replicates Unix shell pipelines by executing multiple commands with proper input/output redirection. Involves fork(), execve(), and pipe management.",
      tech: ["C", "Processes", "Pipes", "Unix"],
      github: "https://github.com/alikoaikk/PIPEX"
    },
    {
      name: "CUB3D",
      icon: "🎮",
      tagline: "A raycasting engine in C",
      type: "Graphics · game engine",
      description: "A raycasting 3D game engine in C inspired by Wolfenstein 3D. Features real-time rendering with textured walls, configurable floor/ceiling colors, player movement, and custom .cub map support.",
      tech: ["C", "Raycasting", "DDA", "Graphics", "MiniLibX"],
      github: "https://github.com/Alikoaikk/Cub3D"
    },
    {
      name: "Python Music Application",
      icon: "🎵",
      tagline: "A desktop music player in Python",
      type: "Desktop app",
      description: "A desktop music player built with Python using Tkinter for the GUI, Pygame for audio playback, and Pandas for managing music metadata. A full-featured media application.",
      tech: ["Python", "Tkinter", "Pygame", "Pandas"],
      github: "https://github.com/alikoaikk/Python-music-Application"
    }
  ],

  // posts.html — LinkedIn posts, newest first, shown as LinkedIn's own
  // embeds (js/posts.js). An entry is the post's link (from "Copy link
  // to post"), or the whole <iframe> code from "Embed this post", or
  // { url, height, date } — height (px) when a long post is cut short.
  posts: [],

  skills: {
    languages: ["C", "C++", "Java", "Python", "JavaScript", "HTML / CSS", "SQL"],
    tools: ["VS Code", "Android Studio", "Apache NetBeans"],
    technologies: ["Linux", "Git", "GitHub", "GDB", "Bootstrap"]
  }
};

window.portfolioData = portfolioData;
