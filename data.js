const portfolioData = {
  personal: {
    name: "Ali Koaik",
    location: "Lebanon",
    email: "alikoaik004@gmail.com",
    status: "Open to opportunities",
    degree: "B.Sc. Computer Science",
    bio: [
      "Computer Science student based in Lebanon, studying at both the University of Science and Arts in Lebanon and 42 Beirut — a project-based, peer-to-peer coding school known for its intensive curriculum.",
      "Passionate about low-level programming, systems design, and building things from scratch. Deep interest in memory management in C, multithreading, and shell pipelines. Also explores Python applications and web development.",
      "Believes great software is built with curiosity, persistence, and clean code. Always looking for new challenges that push growth."
    ]
  },

  socials: {
    email: "alikoaik004@gmail.com",
    github: "https://github.com/alikoaikk",
    linkedin: "https://linkedin.com/in/ali-koaikkoaik-86a4b4272"
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
      badge: "Project-Based & Peer-to-Peer Learning"
    },
    {
      institution: "University of Science and Arts in Lebanon",
      program: "Bachelor of Science in Computer Science – Computing",
      period: "2022 – Present",
      badge: "Computer Science – Computing"
    }
  ],

  projects: [
    {
      name: "MINISHELL",
      icon: "🐚",
      description: "A fully functional Unix shell built in C, replicating core Bash behavior — command execution, pipes, redirections, environment variables, built-in commands, and signal handling. One of the most comprehensive systems projects.",
      tech: ["C", "Bash", "Processes", "Pipes", "Unix"],
      github: "https://github.com/akoaik-msafa/minishell",
      demo: "terminal2.html"
    },
    {
      name: "CPP MODULES",
      icon: "⚙️",
      description: "42 School C++ modules covering OOP fundamentals — classes, memory allocation, operator overloading, inheritance, polymorphism, and abstract classes. A structured progression through modern C++ concepts.",
      tech: ["C++", "OOP", "Inheritance", "Polymorphism"],
      github: "https://github.com/Alikoaikk/cpp"
    },
    {
      name: "SO_LONG",
      icon: "🎮",
      description: "A Harry Potter-themed 2D top-down game in C using the MiniLibX graphics library. Features sprite rendering, four-directional movement, map validation via .ber files, collision detection, and a move counter.",
      tech: ["C", "MiniLibX", "Graphics", "Game Dev"],
      github: "https://github.com/Alikoaikk/SO_LONG",
      demo: "https://youtu.be/S8EFh6rSWDw?si=6wL2AtSBFscp3dZJ"
    },
    {
      name: "PUSH_SWAP",
      icon: "🔢",
      description: "Sorts a stack of integers using only two stacks and a minimal set of operations. Implements radix sort for large sets (100+ numbers) and optimized algorithms for small sets — achieving O(n log n) efficiency.",
      tech: ["C", "Algorithms", "Sorting", "Stacks"],
      github: "https://github.com/Alikoaikk/PUSH_SWAP"
    },
    {
      name: "PHILOSOPHERS",
      icon: "🧵",
      description: "Multithreaded Dining Philosophers simulation in C using POSIX threads and mutexes. Handles race conditions, deadlock prevention, and precise timing — a deep dive into concurrent programming.",
      tech: ["C", "Threads", "Mutexes", "POSIX"],
      github: "https://github.com/alikoaikk/PHILOSOPHERS"
    },
    {
      name: "C_FULL_LIB",
      icon: "📚",
      description: "A unified C library combining libft, ft_printf, and get_next_line into one reusable static library — string manipulation, formatted output, and line-by-line file reading all in one package.",
      tech: ["C", "Variadic", "File I/O", "Static Lib"],
      github: "https://github.com/Alikoaikk/C_Full_Lib"
    },
    {
      name: "PIPEX",
      icon: "🔗",
      description: "Replicates Unix shell pipelines by executing multiple commands with proper input/output redirection. Involves fork(), execve(), and pipe management.",
      tech: ["C", "Processes", "Pipes", "Unix"],
      github: "https://github.com/alikoaikk/PIPEX"
    },
    {
      name: "CUB3D",
      icon: "🎮",
      description: "A raycasting 3D game engine in C inspired by Wolfenstein 3D. Features real-time rendering with textured walls, configurable floor/ceiling colors, player movement, and custom .cub map support.",
      tech: ["C", "Raycasting", "DDA", "Graphics", "MiniLibX"],
      github: "https://github.com/Alikoaikk/Cub3D"
    },
    {
      name: "Python Music Application",
      icon: "🎵",
      description: "A desktop music player built with Python using Tkinter for the GUI, Pygame for audio playback, and Pandas for managing music metadata. A full-featured media application.",
      tech: ["Python", "Tkinter", "Pygame", "Pandas"],
      github: "https://github.com/alikoaikk/Python-music-Application"
    }
  ],

  skills: {
    languages: ["C", "C++", "Java", "Python", "JavaScript", "HTML / CSS", "SQL"],
    tools: ["VS Code", "Android Studio", "Apache NetBeans"],
    technologies: ["Linux", "Git", "GitHub", "GDB", "Bootstrap"]
  }
};

window.portfolioData = portfolioData;
