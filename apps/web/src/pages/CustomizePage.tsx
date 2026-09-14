import { Card, CardContent } from "@nakama/ui/card";
import { ArrowRight01Icon } from "hugeicons-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useOrgPlugins } from "@/hooks/use-plugins";
import {
  enabledPluginNavEntries,
  navHrefForPage,
  pluginIcon,
  visibleNavGroups,
} from "@/lib/navigation";

export function CustomizePage() {
  const { user, activeOrg } = useAuth();
  const { data: plugins = [], isLoading, error } = useOrgPlugins();
  const items = visibleNavGroups({
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  }).flatMap((group) => group.items);
  const sections = [
    {
      pages: ["organization", "usage", "workers", "settings"],
      title: "Workspace",
    },
    {
      pages: ["providers", "tools", "mcp", "plugin-management"],
      title: "Agent tools",
    },
  ].map(({ title, pages }) => ({
    items: pages.flatMap((page) => {
      const item = items.find((entry) => entry.id === page);
      return item
        ? [
            {
              href: navHrefForPage(item.id),
              icon: item.icon,
              label: item.label,
            },
          ]
        : [];
    }),
    title,
  }));
  sections.push({
    items: enabledPluginNavEntries(plugins).map((entry) => ({
      href: entry.href,
      icon: pluginIcon(entry.pluginId),
      label: entry.label,
    })),
    title: "Installed plugins",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <section
            aria-label={section.title}
            className="space-y-3"
            key={section.title}
          >
            <h2 className="type-section-title font-normal text-muted-foreground/55">
              {section.title}
            </h2>
            <Card className="w-full overflow-hidden shadow-none">
              <CardContent className="p-0">
                <nav
                  aria-label={section.title}
                  className="divide-y divide-border"
                >
                  {section.items.map(({ href, icon: Icon, label }) => (
                    <Link
                      className="flex min-w-0 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                      key={href}
                      to={href}
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1 truncate font-normal">
                        {label}
                      </span>
                      <ArrowRight01Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                    </Link>
                  ))}
                </nav>
              </CardContent>
            </Card>
          </section>
        ))}
      {isLoading && (
        <p className="mt-4 text-muted-foreground text-sm" role="status">
          Loading plugins…
        </p>
      )}
      {error && (
        <p className="mt-4 text-muted-foreground text-sm" role="status">
          Couldn’t load plugins.
        </p>
      )}
    </div>
  );
}
